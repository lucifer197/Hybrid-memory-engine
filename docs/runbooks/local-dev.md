# Local Development Runbook

## Prerequisites

| Tool       | Version  | Purpose                        |
|------------|----------|--------------------------------|
| Node.js    | >= 20    | TypeScript services            |
| Python     | >= 3.11  | embedding-worker               |
| Docker     | >= 24    | Postgres (pgvector) and Redis  |
| npm        | >= 10    | Workspace management           |

---

## 1. Start the Stack

### Option A: Docker Compose (recommended)

Starts all services, Postgres, and Redis in one command:

```bash
cd infra/docker
docker compose -f docker-compose.dev.yml up -d
```

Verify everything is running:

```bash
docker compose -f docker-compose.dev.yml ps
```

Expected services and ports:

| Service                 | Port | Health endpoint              |
|-------------------------|------|------------------------------|
| postgres (pgvector)     | 5432 | Docker healthcheck           |
| redis                   | 6379 | Docker healthcheck           |
| api-gateway             | 3000 | `GET /livez`                 |
| memory-service          | 3001 | `GET /livez`                 |
| retrieval-orchestrator  | 3002 | `GET /livez`                 |
| graph-worker            | 3003 | metrics only                 |
| lifecycle-worker        | 3004 | metrics only                 |
| consolidation-worker    | 3005 | metrics only                 |
| truth-worker            | 3006 | metrics only                 |
| embedding-worker        | 3007 | `GET /healthz`               |

### Option B: Infrastructure only + local services

Start only Postgres and Redis via Docker:

```bash
cd infra/docker
docker compose -f docker-compose.dev.yml up -d postgres redis
```

Then run services locally in separate terminals:

```bash
# Terminal 1 — run migrations first
cd apps/memory-service
npm run migrate

# Terminal 2
cd apps/memory-service && npm run dev

# Terminal 3
cd apps/retrieval-orchestrator && npm run dev

# Terminal 4
cd apps/api-gateway && npm run dev

# Terminal 5 — Python embedding worker
cd apps/embedding-worker
pip install -r requirements.txt
python -m src.main

# Terminal 6
cd apps/consolidation-worker && npm run dev

# Terminal 7
cd apps/truth-worker && npm run dev
```

---

## 2. Stop the Stack

```bash
# Stop all containers (preserves volumes)
cd infra/docker
docker compose -f docker-compose.dev.yml down

# Stop AND destroy data volumes (full reset)
docker compose -f docker-compose.dev.yml down -v
```

---

## 3. Run Database Migrations

Migrations live in `apps/memory-service/src/migrations/` (001 through 018).

```bash
# Via npm script
cd apps/memory-service
npm run migrate

# Or manually against a running Postgres
DATABASE_URL=postgres://hybrid:hybrid@localhost:5432/hybrid_memory \
  npx ts-node src/migrations/run.ts
```

Docker Compose auto-runs migrations on first start by mounting SQL files to `/docker-entrypoint-initdb.d/`.

---

## 4. Environment Variables

No `.env` files are committed. All config uses defaults suitable for local dev. Override as needed:

```bash
# Core (shared by all services)
DATABASE_URL=postgres://hybrid:hybrid@localhost:5432/hybrid_memory
REDIS_URL=redis://localhost:6379
NODE_ENV=development
LOG_LEVEL=debug

# Embedding (retrieval-orchestrator + embedding-worker)
OPENAI_API_KEY=sk-...          # required for real embeddings
MOCK_EMBEDDINGS=true           # set to true to skip OpenAI calls
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIM=1536
```

See each service's `src/config/env.ts` (or `src/config.py` for embedding-worker) for the full list with defaults.

---

## 5. Test write_turn

Send a memory through the gateway:

```bash
curl -s -X POST http://localhost:3000/api/v1/turns \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "demo-tenant",
    "workspace_id": "demo-ws",
    "user_id": "user-1",
    "session_id": "sess-1",
    "turns": [
      {
        "role": "user",
        "content": "I prefer dark mode in my editor and use TypeScript for everything."
      },
      {
        "role": "assistant",
        "content": "Got it! I will remember your preferences."
      }
    ]
  }' | jq .
```

Expected: 200 with `memory_id` and `chunk_ids` in the response.

### Verify the write landed

```bash
# Check the memory exists in Postgres
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "SELECT memory_id, status, memory_type FROM memories WHERE tenant_id = 'demo-tenant' ORDER BY created_at DESC LIMIT 5;"
```

### Verify embedding job was enqueued

```bash
redis-cli -u redis://localhost:6379 LLEN embed:jobs
```

---

## 6. Test Retrieve

```bash
curl -s -X POST http://localhost:3000/api/v1/retrieve \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "demo-tenant",
    "workspace_id": "demo-ws",
    "user_id": "user-1",
    "query": "What editor theme does the user prefer?",
    "limit": 5
  }' | jq .
```

If `MOCK_EMBEDDINGS=true`, retrieval will return results based on mock vectors (useful for testing the pipeline without OpenAI).

---

## 7. Build All Services

```bash
# From repo root
npm run build
```

This builds all workspaces (shared packages first, then apps).

---

## 8. Run Tests

```bash
# Unit tests (all workspaces)
npm run test

# DB-dependent tests (requires running Postgres)
DB_TESTS=1 DATABASE_URL=postgres://hybrid:hybrid@localhost:5432/hybrid_memory \
  npm run test --workspace=apps/memory-service

DB_TESTS=1 DATABASE_URL=postgres://hybrid:hybrid@localhost:5432/hybrid_memory \
  npm run test --workspace=apps/retrieval-orchestrator

DB_TESTS=1 DATABASE_URL=postgres://hybrid:hybrid@localhost:5432/hybrid_memory \
  npm run test --workspace=apps/consolidation-worker

DB_TESTS=1 DATABASE_URL=postgres://hybrid:hybrid@localhost:5432/hybrid_memory \
  npm run test --workspace=apps/truth-worker

# Watch mode (single service)
cd apps/memory-service && npm run test:watch
```

---

## 9. Reset Everything

```bash
# Nuclear option: destroy containers + volumes, rebuild
cd infra/docker
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d --build
```

To reset just the database:

```bash
psql postgres://hybrid:hybrid@localhost:5432/hybrid_memory -c \
  "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Then re-run migrations
cd apps/memory-service && npm run migrate
```
