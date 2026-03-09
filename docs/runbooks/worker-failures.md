# Worker Failures Runbook

## Worker Overview

| Worker               | Queue              | DLQ                  | Port | Purpose                           |
|----------------------|--------------------|----------------------|------|-----------------------------------|
| embedding-worker     | `embed:jobs`       | `embed:dlq`          | 3007 | Generate vector embeddings        |
| consolidation-worker | `consolidation:jobs` | `consolidation:dlq` | 3005 | Extract facts, belief revision    |
| truth-worker         | (scheduled)        | n/a                  | 3006 | Contradiction resolution, stale review |
| graph-worker         | `graph:jobs`       | (none)               | 3003 | Build memory relationship edges   |
| lifecycle-worker     | (scheduled)        | n/a                  | 3004 | Retention, decay, cleanup         |

---

## Retry Policy

All queue-based workers use the same retry strategy:

| Parameter         | Default | Env var            |
|-------------------|---------|--------------------|
| Max attempts      | 3       | `JOB_MAX_ATTEMPTS` |
| Base backoff      | 1s      | —                  |
| Max backoff       | 30s     | —                  |
| Backoff strategy  | Exponential with full jitter | — |

After `JOB_MAX_ATTEMPTS` failures, the job is moved to the dead-letter queue (both Redis and Postgres).

### Retry metadata stamped on each job

```json
{
  "_attempt_count": 2,
  "_last_failed_at": "2026-03-06T12:34:56Z",
  "_last_error": "Connection refused",
  "_last_stack": "Error: Connection refused\n    at ..."
}
```

---

## Dead-Letter Queue (DLQ) Management

### Check DLQ depth

```bash
# Redis DLQ
redis-cli LLEN embed:dlq
redis-cli LLEN consolidation:dlq

# Postgres DLQ (persisted — survives Redis restart)
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT job_type, COUNT(*) FROM dead_letter_jobs WHERE resolved_at IS NULL GROUP BY job_type;"
```

### Inspect DLQ entries

```bash
# View recent dead-letter entries from Redis
redis-cli LRANGE embed:dlq 0 4

# View from Postgres (more detail)
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT id, job_type, queue_name, error_message, attempt_count, created_at
   FROM dead_letter_jobs
   WHERE resolved_at IS NULL
   ORDER BY created_at DESC
   LIMIT 10;"
```

### View full error details

```sql
SELECT id, job_type, error_message, stack_trace, payload
FROM dead_letter_jobs
WHERE id = 'YOUR_DLQ_ENTRY_ID';
```

### Requeue a dead-letter job

To retry a failed job, push it back to the source queue:

```bash
# 1. Get the job payload from Postgres
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT payload FROM dead_letter_jobs WHERE id = 'YOUR_DLQ_ENTRY_ID';" -t -A

# 2. Push it back to the queue (reset retry metadata first)
redis-cli LPUSH embed:jobs '{"memory_id":"...","chunk_ids":["..."],"tenant_id":"...","workspace_id":"..."}'

# 3. Mark the DLQ entry as resolved
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "UPDATE dead_letter_jobs SET resolved_at = NOW(), resolved_by = 'manual-requeue' WHERE id = 'YOUR_DLQ_ENTRY_ID';"
```

### Bulk requeue all unresolved DLQ entries for a job type

```sql
-- View what would be requeued
SELECT id, error_message, created_at
FROM dead_letter_jobs
WHERE job_type = 'embedding' AND resolved_at IS NULL;
```

```bash
# Extract payloads and push them back
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -t -A -c \
  "SELECT payload::text FROM dead_letter_jobs WHERE job_type = 'embedding' AND resolved_at IS NULL;" \
  | while read payload; do
      redis-cli LPUSH embed:jobs "$payload"
    done

# Mark all as resolved
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "UPDATE dead_letter_jobs SET resolved_at = NOW(), resolved_by = 'bulk-requeue' WHERE job_type = 'embedding' AND resolved_at IS NULL;"
```

---

## Common Failure Modes and Fixes

### Embedding worker: "OpenAI API timeout"

**Symptoms**: `job_failed` logs with timeout errors, rising `embed:dlq` depth.

**Cause**: OpenAI API is slow or rate-limiting.

**Fix**:
1. Check OpenAI status: https://status.openai.com/
2. If rate-limited, reduce batch size or add delay between jobs.
3. For local dev, set `MOCK_EMBEDDINGS=true` to bypass OpenAI entirely.
4. The circuit breaker will auto-open after 5 failures and stop sending requests for 30s.

### Embedding worker: "Connection refused" to Postgres

**Symptoms**: `job_failed` with `psycopg2.OperationalError`.

**Fix**:
1. Verify Postgres is running: `docker compose ps postgres`
2. Check connection limit: `SELECT count(*) FROM pg_stat_activity;`
3. Restart the embedding worker — it will reconnect.

### Consolidation worker: "Transaction timeout"

**Symptoms**: `consolidation_timeout` in logs.

**Cause**: A single consolidation job took longer than `CONSOLIDATION_JOB_TIMEOUT_MS` (default 30s).

**Fix**:
1. Check for lock contention: `SELECT * FROM pg_locks WHERE NOT granted;`
2. Increase `CONSOLIDATION_JOB_TIMEOUT_MS` if the memory is legitimately large.
3. The job will be retried automatically. If it keeps failing, it goes to DLQ.

### Truth worker: "Sweep timeout"

**Symptoms**: `truth_sweep_timeout` or `stale_review_timeout` in logs.

**Cause**: Too many contradictions or stale facts to process in one sweep.

**Fix**:
1. Reduce `BATCH_SIZE` (default 100) to process fewer facts per sweep.
2. Increase `TRUTH_SWEEP_TIMEOUT_MS` (default 30s).
3. Check for runaway contradiction creation: `SELECT COUNT(*) FROM fact_contradictions WHERE resolution = 'unresolved';`

### Any worker: "Redis connection lost"

**Symptoms**: Worker hangs or crashes with Redis connection error.

**Fix**:
1. Verify Redis is running: `redis-cli ping`
2. Check Redis memory usage: `redis-cli INFO memory`
3. Restart the worker — it will reconnect on next iteration.
4. Jobs in-flight at disconnect time are lost. Check for missing embeddings after recovery (see retrieval-debugging.md).

### Memory-service: "Write succeeds but embedding never appears"

**Symptoms**: Memory exists in DB, chunks exist, but no rows in `chunk_embeddings`.

**Diagnosis**:
```bash
# Is the job in the queue?
redis-cli LLEN embed:jobs

# Is the job in the DLQ?
redis-cli LLEN embed:dlq

# Is the embedding worker running?
curl -sf http://localhost:3007/healthz | jq .
```

**Fix**:
1. If the worker is down, start it. Jobs are persisted in Redis and will be processed.
2. If the job is in the DLQ, inspect the error and requeue (see DLQ Management above).
3. If the job is missing entirely (Redis was flushed), re-trigger by updating the memory:
   ```sql
   -- This is a last resort. Manually enqueue an embedding job:
   -- Use the chunk_ids from the memory
   SELECT chunk_id FROM memory_chunks WHERE memory_id = 'YOUR_MEMORY_ID';
   ```
   Then push a job to Redis:
   ```bash
   redis-cli LPUSH embed:jobs '{"memory_id":"...","chunk_ids":["..."],"tenant_id":"...","workspace_id":"..."}'
   ```

### Postgres: "Too many connections"

**Symptoms**: `FATAL: too many connections for role "hybrid"` in any service.

**Fix**:
1. Check active connections: `SELECT count(*), application_name FROM pg_stat_activity WHERE datname = 'hybrid_memory' GROUP BY application_name;`
2. Kill idle connections: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'hybrid_memory' AND state = 'idle' AND query_start < NOW() - INTERVAL '5 minutes';`
3. Consider reducing pool sizes in services or increasing `max_connections` in Postgres.

### Postgres: "Statement timeout"

**Symptoms**: `canceling statement due to statement timeout` in worker logs.

**Fix**:
1. The embedding-worker sets a 15s statement timeout via `DB_STATEMENT_TIMEOUT_MS`.
2. Other services use default Postgres timeouts.
3. Check for long-running queries: `SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'active' AND query_start < NOW() - INTERVAL '10 seconds';`
4. If a specific table is slow, check for missing indexes or table bloat.

---

## Monitoring Checklist (Daily)

```bash
# 1. All services healthy?
for port in 3000 3001 3002; do curl -sf http://localhost:$port/readyz | jq -r '.service + ": " + .status'; done

# 2. Queue depths normal?
echo "embed:jobs  $(redis-cli LLEN embed:jobs)"
echo "embed:dlq   $(redis-cli LLEN embed:dlq)"
echo "consol:jobs $(redis-cli LLEN consolidation:jobs)"
echo "consol:dlq  $(redis-cli LLEN consolidation:dlq)"

# 3. DLQ entries since yesterday?
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT job_type, COUNT(*) FROM dead_letter_jobs WHERE resolved_at IS NULL AND created_at > NOW() - INTERVAL '24 hours' GROUP BY job_type;"

# 4. Unresolved contradictions growing?
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT COUNT(*) AS unresolved_contradictions FROM fact_contradictions WHERE resolution = 'unresolved';"

# 5. Embedding lag (chunks without embeddings)?
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT COUNT(*) AS chunks_without_embeddings FROM memory_chunks mc LEFT JOIN chunk_embeddings ce ON ce.chunk_id = mc.chunk_id WHERE ce.chunk_id IS NULL;"
```
