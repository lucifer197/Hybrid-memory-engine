# Retrieval Debugging Runbook

## How Retrieval Works

The retrieval pipeline flows through these stages:

```
Client request
  -> api-gateway (port 3000)
    -> retrieval-orchestrator (port 3002)
      1. Embed the query text (OpenAI or mock)
      2. Vector search (pgvector cosine similarity)
      3. Graph expansion (1-hop related memories)
      4. Fact assembly (keyword + evidence lookup)
      5. Truth-aware ranking (composite scoring)
      6. Deduplication + final ordering
    <- return ranked chunks + facts
  <- return to client
```

Each stage has its own timeout and fallback (see Fallback Rules below).

---

## Quick Diagnostic Checklist

If retrieval returns empty or unexpected results, walk through this:

| Check | Command |
|-------|---------|
| Service is up | `curl -sf http://localhost:3002/readyz \| jq .` |
| Memory exists in DB | See "Verify memory exists" below |
| Chunks exist | See "Verify chunks exist" below |
| Embeddings exist | See "Verify embeddings exist" below |
| Correct tenant/workspace | Check request params match stored data |
| Privacy scope | Private memories only return for the owning user_id |
| Memory not deleted | `status` must be `'active'` or `'archived'` |

---

## Step-by-Step Debugging

### 1. Verify the memory exists

```sql
SELECT memory_id, tenant_id, workspace_id, user_id, status, privacy_scope, memory_type
FROM memories
WHERE tenant_id = 'YOUR_TENANT' AND workspace_id = 'YOUR_WS'
ORDER BY created_at DESC
LIMIT 10;
```

Common issues:
- `status = 'deleted'` — memory was forgotten, won't appear in results
- `privacy_scope = 'private'` and querying as a different `user_id`

### 2. Verify chunks exist

```sql
SELECT mc.chunk_id, mc.memory_id, mc.chunk_index, LEFT(mc.chunk_text, 80) AS text_preview
FROM memory_chunks mc
JOIN memories m ON m.memory_id = mc.memory_id
WHERE m.tenant_id = 'YOUR_TENANT' AND m.workspace_id = 'YOUR_WS'
ORDER BY mc.created_at DESC
LIMIT 10;
```

If no chunks: the memory-service write may have failed to chunk the content.

### 3. Verify embeddings exist

```sql
SELECT ce.chunk_id, ce.embedding_model, ce.embedding_dim,
       LEFT(ce.embedding::text, 40) AS vec_preview
FROM chunk_embeddings ce
WHERE ce.tenant_id = 'YOUR_TENANT' AND ce.workspace_id = 'YOUR_WS'
LIMIT 10;
```

If chunks exist but no embeddings:
- Check `redis-cli LLEN embed:jobs` — job may be queued
- Check `redis-cli LLEN embed:dlq` — job may have failed
- Check embedding-worker logs: `docker compose logs -f embedding-worker`

### 4. Test vector search directly

```sql
-- Find memories similar to an existing chunk's embedding
SELECT mc.memory_id, mc.chunk_text,
       ce.embedding <=> (SELECT embedding FROM chunk_embeddings LIMIT 1) AS distance
FROM chunk_embeddings ce
JOIN memory_chunks mc ON mc.chunk_id = ce.chunk_id
JOIN memories m ON m.memory_id = mc.memory_id
WHERE ce.tenant_id = 'YOUR_TENANT'
  AND ce.workspace_id = 'YOUR_WS'
  AND m.status IN ('active', 'archived')
ORDER BY distance
LIMIT 5;
```

### 5. Check graph edges

```sql
SELECT me.source_memory_id, me.target_memory_id, me.edge_type, me.weight
FROM memory_edges me
WHERE me.tenant_id = 'YOUR_TENANT' AND me.workspace_id = 'YOUR_WS'
ORDER BY me.created_at DESC
LIMIT 20;
```

### 6. Check facts

```sql
SELECT fact_id, subject, predicate, value_text, truth_status, confidence, trust_score
FROM semantic_facts
WHERE tenant_id = 'YOUR_TENANT' AND workspace_id = 'YOUR_WS' AND user_id = 'YOUR_USER'
  AND truth_status = 'active'
ORDER BY confidence DESC
LIMIT 20;
```

---

## Fallback Rules

The retrieval pipeline degrades gracefully. If a stage fails, it continues with reduced data:

| Stage            | Failure behavior             | Log event                  |
|------------------|------------------------------|----------------------------|
| Query embedding  | Request fails (no fallback)  | `embed_failed`             |
| Vector search    | Retries once, then fails     | `vector_search_retry`      |
| Graph expansion  | Skipped, vector-only results | `graph_expansion_fallback` |
| Fact lookup      | Skipped, no facts returned   | `fact_lookup_fallback`     |
| Truth ranking    | Falls back to base ranking   | `truth_rank_fallback`      |
| Overall pipeline | Times out after 10s          | `retrieval_timeout`        |

### Timeout configuration

| Timeout                    | Default | Env var                    |
|----------------------------|---------|----------------------------|
| Query embedding            | 10s     | `EMBED_TIMEOUT_MS`         |
| Vector search              | 5s      | `VECTOR_SEARCH_TIMEOUT_MS` |
| Graph expansion            | 3s      | `GRAPH_EXPAND_TIMEOUT_MS`  |
| Fact lookup                | 3s      | `FACT_LOOKUP_TIMEOUT_MS`   |
| Overall retrieval pipeline | 10s     | `RETRIEVAL_TIMEOUT_MS`     |

---

## Common Retrieval Issues

### "Empty results but data is in the DB"

1. **Embeddings not yet generated** — Check `redis-cli LLEN embed:jobs`. The embedding-worker may be behind.
2. **Wrong tenant/workspace** — The request params must exactly match the stored data.
3. **Privacy scope** — Private memories only return for their `user_id`.
4. **Mock embeddings mismatch** — If `MOCK_EMBEDDINGS=true`, mock vectors are deterministic by input text. Different query text = different vector = no match.

### "Retrieval is slow (> 2s)"

1. Check `GET /metrics` on retrieval-orchestrator for `retrieval_duration_ms` histogram.
2. Check if graph expansion is timing out (look for `graph_expansion_fallback` in logs).
3. Check Postgres connection pool: `SELECT count(*), state FROM pg_stat_activity WHERE datname = 'hybrid_memory' GROUP BY state;`
4. Check if a circuit breaker is open (half-open probes add latency).

### "Facts not appearing in results"

1. Verify facts exist and are `truth_status = 'active'`.
2. Check if the consolidation-worker has processed the memory (`docker compose logs consolidation-worker`).
3. Ensure fact evidence links exist: `SELECT * FROM fact_evidence WHERE fact_id = 'YOUR_FACT_ID';`

### "Retrieval timeout (10s)"

1. Usually caused by a slow embedding call to OpenAI.
2. Check `MOCK_EMBEDDINGS=true` for local dev to bypass OpenAI.
3. Check if the embedding circuit breaker is open.
4. Increase `RETRIEVAL_TIMEOUT_MS` if the timeout is consistently too tight.

---

## Trace a Request End-to-End

Every request includes a `trace_id` in logs. To follow a request through all services:

```bash
TRACE_ID="your-trace-id-here"

# Search all service logs for this trace
docker compose -f docker-compose.dev.yml logs 2>&1 | grep "$TRACE_ID"
```

The trace will show:
1. Gateway receives request
2. Retrieval-orchestrator starts pipeline
3. Embedding generated (or cache hit)
4. Vector search executed
5. Graph expansion (or fallback)
6. Fact assembly (or fallback)
7. Truth ranking
8. Response returned

---

## Embedding Cache

The retrieval-orchestrator caches query embeddings and retrieval results in memory:

| Cache               | Default TTL | Default max size | Env var                  |
|---------------------|-------------|------------------|--------------------------|
| Query embeddings    | 5 min       | 500 entries      | `EMBED_CACHE_TTL_MS`     |
| Retrieval results   | 30 sec      | 200 entries      | `RETRIEVAL_CACHE_TTL_MS` |

Caches are in-process LRU. Restart the service to clear them. There is no manual cache flush endpoint.
