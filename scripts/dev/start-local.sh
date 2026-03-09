#!/usr/bin/env bash
set -euo pipefail

# ── Local dev startup ─────────────────────────────────────────
# Starts all services needed for the full pipeline.
#
# Prerequisites:
#   - Docker (for Postgres + Redis)
#   - Node.js 22+
#   - Python 3.12+ with pip
#   - npm install at repo root
#
# Usage:
#   bash scripts/dev/start-local.sh

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "══════════════════════════════════════════════"
echo "  Hybrid Memory — Local Dev Startup"
echo "══════════════════════════════════════════════"

# ── 1. Start Postgres + Redis via Docker ──────────────────
echo ""
echo "1) Starting Postgres (pgvector) + Redis ..."
docker compose -f infra/docker/docker-compose.dev.yml up -d postgres redis
echo "   Waiting for health checks ..."
sleep 3

# ── 2. Run migrations ────────────────────────────────────
echo ""
echo "2) Running database migrations ..."
cd apps/memory-service
DATABASE_URL="postgres://hybrid:hybrid@localhost:5432/hybrid_memory" \
  npx ts-node src/migrations/run.ts
cd "$ROOT"

# ── 3. Install Python deps ───────────────────────────────
echo ""
echo "3) Installing embedding-worker Python deps ..."
cd apps/embedding-worker
pip install -q -r requirements.txt
cd "$ROOT"

# ── 4. Start services in background ──────────────────────
echo ""
echo "4) Starting services ..."

# Memory Service (port 3001)
echo "   → memory-service on :3001"
cd apps/memory-service
DATABASE_URL="postgres://hybrid:hybrid@localhost:5432/hybrid_memory" \
REDIS_URL="redis://localhost:6379" \
PORT=3001 \
  npx ts-node-dev --respawn src/http/server.ts &
PIDS="$!"
cd "$ROOT"

# Embedding Worker (Python)
echo "   → embedding-worker (Python)"
cd apps/embedding-worker
DATABASE_URL="postgres://hybrid:hybrid@localhost:5432/hybrid_memory" \
REDIS_URL="redis://localhost:6379" \
MOCK_EMBEDDINGS="${MOCK_EMBEDDINGS:-true}" \
  python -m src.main &
PIDS="$PIDS $!"
cd "$ROOT"

# Graph Worker
echo "   → graph-worker"
cd apps/graph-worker
DATABASE_URL="postgres://hybrid:hybrid@localhost:5432/hybrid_memory" \
REDIS_URL="redis://localhost:6379" \
  npx ts-node-dev --respawn src/main.ts &
PIDS="$PIDS $!"
cd "$ROOT"

# Retrieval Orchestrator (port 3002)
echo "   → retrieval-orchestrator on :3002"
cd apps/retrieval-orchestrator
DATABASE_URL="postgres://hybrid:hybrid@localhost:5432/hybrid_memory" \
REDIS_URL="redis://localhost:6379" \
MOCK_EMBEDDINGS="${MOCK_EMBEDDINGS:-true}" \
PORT=3002 \
  npx ts-node-dev --respawn src/http/server.ts &
PIDS="$PIDS $!"
cd "$ROOT"

# Lifecycle Worker
echo "   → lifecycle-worker"
cd apps/lifecycle-worker
DATABASE_URL="postgres://hybrid:hybrid@localhost:5432/hybrid_memory" \
REDIS_URL="redis://localhost:6379" \
  npx ts-node-dev --respawn src/main.ts &
PIDS="$PIDS $!"
cd "$ROOT"

# API Gateway (port 3000)
echo "   → api-gateway on :3000"
cd apps/api-gateway
MEMORY_SERVICE_URL="http://localhost:3001" \
RETRIEVAL_ORCHESTRATOR_URL="http://localhost:3002" \
PORT=3000 \
  npx ts-node-dev --respawn src/index.ts &
PIDS="$PIDS $!"
cd "$ROOT"

echo ""
echo "══════════════════════════════════════════════"
echo "  All services started. PIDs: $PIDS"
echo ""
echo "  API Gateway:           http://localhost:3000"
echo "  Memory Service:        http://localhost:3001"
echo "  Retrieval Orchestrator: http://localhost:3002"
echo ""
echo "  Press Ctrl+C to stop all services."
echo "══════════════════════════════════════════════"

# Wait for all background processes
trap "kill $PIDS 2>/dev/null; exit" INT TERM
wait
