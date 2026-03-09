# System Health Runbook

## Service Health Endpoints

Every service exposes health probes:

| Endpoint   | Purpose                          | Healthy response       |
|------------|----------------------------------|------------------------|
| `GET /livez`  | Liveness — process is running | `200 { status: "ok" }` |
| `GET /readyz` | Readiness — dependencies up   | `200 { status: "ok" }` |
| `GET /health` | Alias for liveness             | `200 { status: "ok" }` |

### Quick health check (all services)

```bash
for port in 3000 3001 3002; do
  echo "=== Port $port ==="
  curl -sf http://localhost:$port/readyz | jq .
done
```

### Readiness response format

```json
{
  "service": "memory-service",
  "status": "ok",
  "version": "0.1.0",
  "timestamp": "2026-03-06T12:00:00.000Z",
  "dependencies": {
    "postgres": { "status": "ok", "latency_ms": 2 },
    "redis": { "status": "ok", "latency_ms": 1 }
  }
}
```

If a dependency is down, `status` becomes `"degraded"` or `"unavailable"`.

---

## Metrics

All services expose `GET /metrics` returning JSON counters, gauges, and histograms.

### Key metrics to watch

**api-gateway (port 3000)**:
- `http_requests_total` — request count by route and status
- `http_request_duration_ms` — latency histogram

**memory-service (port 3001)**:
- `write_turn_total` — turns written
- `write_turn_errors_total` — write failures

**retrieval-orchestrator (port 3002)**:
- `retrieval_requests_total` — retrieval attempts
- `retrieval_timeout_total` — pipeline timeouts
- `retry_attempt_total` — retry counts by operation
- `circuit_breaker_open_total` — breaker trips

**embedding-worker (port 3007)**:
- `embedding_jobs_total` — jobs processed
- `embedding_job_failures_total` — job failures
- `job_retry_total` — retries
- `job_dlq_total` — dead-lettered jobs
- `queue_depth` — current queue length
- `dlq_depth` — current DLQ length

**consolidation-worker (port 3005)**:
- `consolidation_jobs_total` — jobs processed
- `consolidation_errors_total` — failures
- `facts_created_total`, `facts_reinforced_total`, `facts_superseded_total`

**truth-worker (port 3006)**:
- `contradiction_sweeps_total` — sweep runs
- `stale_review_sweeps_total` — stale review runs
- `facts_resolved_total` — contradictions resolved

### Fetch metrics

```bash
curl -s http://localhost:3000/metrics | jq .
curl -s http://localhost:3001/metrics | jq .
curl -s http://localhost:3002/metrics | jq .
curl -s http://localhost:3007/metrics | jq .
```

---

## Inspect Postgres

### Connect

```bash
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory
```

### Useful queries

```sql
-- Total memories by tenant
SELECT tenant_id, status, COUNT(*)
FROM memories
GROUP BY tenant_id, status
ORDER BY tenant_id;

-- Recent memories
SELECT memory_id, tenant_id, memory_type, status, created_at
FROM memories
ORDER BY created_at DESC
LIMIT 20;

-- Chunks without embeddings (embedding lag)
SELECT mc.chunk_id, mc.memory_id, mc.created_at
FROM memory_chunks mc
LEFT JOIN chunk_embeddings ce ON ce.chunk_id = mc.chunk_id
WHERE ce.chunk_id IS NULL
ORDER BY mc.created_at DESC
LIMIT 20;

-- Semantic facts summary
SELECT tenant_id, truth_status, COUNT(*)
FROM semantic_facts
GROUP BY tenant_id, truth_status
ORDER BY tenant_id;

-- Unresolved contradictions
SELECT fc.id, fc.tenant_id, fc.fact_a_id, fc.fact_b_id, fc.contradiction_type
FROM fact_contradictions fc
WHERE fc.resolution = 'unresolved'
ORDER BY fc.created_at DESC
LIMIT 20;

-- Dead letter jobs (unresolved)
SELECT id, job_type, queue_name, error_message, attempt_count, created_at
FROM dead_letter_jobs
WHERE resolved_at IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- Table sizes
SELECT relname AS table,
       pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC;

-- Active connections
SELECT count(*) AS total, state
FROM pg_stat_activity
WHERE datname = 'hybrid_memory'
GROUP BY state;
```

---

## Inspect Redis Queues

### Connect

```bash
redis-cli -u redis://localhost:6379
```

### Queue depths

```bash
redis-cli LLEN embed:jobs
redis-cli LLEN embed:dlq
redis-cli LLEN consolidation:jobs
redis-cli LLEN consolidation:dlq
redis-cli LLEN graph:jobs
```

### Peek at queue contents (non-destructive)

```bash
# View next job to be processed (rightmost = next BRPOP target)
redis-cli LRANGE embed:jobs -1 -1

# View all DLQ entries
redis-cli LRANGE embed:dlq 0 -1

# View first 5 jobs in consolidation queue
redis-cli LRANGE consolidation:jobs 0 4
```

### Flush a queue (use with caution)

```bash
redis-cli DEL embed:jobs         # clear embedding queue
redis-cli DEL consolidation:dlq  # clear consolidation DLQ
```

---

## View Logs

All services emit structured JSON logs to stdout/stderr.

### Docker Compose logs

```bash
cd infra/docker

# All services
docker compose -f docker-compose.dev.yml logs -f

# Single service
docker compose -f docker-compose.dev.yml logs -f memory-service

# Last 100 lines
docker compose -f docker-compose.dev.yml logs --tail=100 api-gateway
```

### Filter by log level or event

```bash
# Errors only
docker compose -f docker-compose.dev.yml logs -f 2>&1 | grep '"level":"error"'

# Specific event
docker compose -f docker-compose.dev.yml logs -f 2>&1 | grep '"event":"job_failed"'

# By trace_id
docker compose -f docker-compose.dev.yml logs -f 2>&1 | grep '"trace_id":"abc-123"'
```

### Log levels

Set `LOG_LEVEL` per service: `debug`, `info`, `warn`, `error`.

```bash
# Enable debug logging for a single service
LOG_LEVEL=debug npm run dev
```

---

## Circuit Breaker Status

Circuit breakers protect against cascading failures. When a breaker opens, the service fast-fails requests to the downstream dependency.

### Breakers in the system

| Location               | Breaker name            | Threshold | Reset     |
|------------------------|-------------------------|-----------|-----------|
| api-gateway            | `memory_service`        | 5 fails   | 30s       |
| api-gateway            | `retrieval_orchestrator`| 5 fails   | 30s       |
| retrieval-orchestrator | `embed`                 | 5 fails   | 30s       |
| retrieval-orchestrator | `graph`                 | 3 fails   | 20s       |
| embedding-worker       | `openai_embed`          | 5 fails   | 30s       |

### Detect open breakers

Look for log events:

```bash
docker compose -f docker-compose.dev.yml logs -f 2>&1 | grep "circuit_breaker"
```

Log entry when a breaker trips:
```json
{ "event": "circuit_breaker_transition", "breaker": "memory_service", "from": "closed", "to": "open" }
```

The breaker will auto-reset after the configured timeout. No manual intervention is needed unless the downstream service is permanently down.
