# Hybrid Memory Engine

A multi-signal memory system for AI applications. Combines vector similarity, graph relationships, temporal decay, truth maintenance, and lifecycle management into a unified retrieval pipeline.

## Architecture

```
User Query
    |
    v
Stage 1 - Fast candidate retrieval (vector search, <80ms)
    |
    v
Stage 2 - Hybrid intelligence ranking (graph + fusion formula, <150ms)
    |
    v
Stage 3 - Context selection (dedup + prioritize, <30ms)
    |
    v
Final context returned to AI
```

## Services

| Service | Purpose |
|---------|---------|
| `api-gateway` | HTTP entry point, request routing, auth |
| `memory-service` | Write path: ingest turns, store memories, extract facts |
| `retrieval-orchestrator` | Read path: three-stage retrieval pipeline |
| `embedding-worker` | Generate vector embeddings (Python, OpenAI) |
| `graph-worker` | Build and maintain memory relationship graph |
| `lifecycle-worker` | Stability decay, reinforcement, auto-archival |
| `consolidation-worker` | Merge related memories, deduplicate |
| `truth-worker` | Fact verification, contradiction resolution, staleness |

## Packages

| Package | Purpose |
|---------|---------|
| `shared-types` | DTOs, enums, validation schemas |
| `observability` | Structured logging, metrics, circuit breakers, retries |
| `config` | Shared configuration utilities |

## Ranking Formula

Memories and facts are scored using a weighted fusion of six signals:

**Memory weights:** 0.45 vector + 0.20 graph + 0.10 recency + 0.10 stability + 0.10 truth + 0.05 importance

**Fact weights:** 0.35 vector + 0.15 graph + 0.10 recency + 0.15 stability + 0.20 truth + 0.05 importance

Penalties applied for: archived (x0.75), contested (x0.70), superseded (x0.25), low-confidence (x0.85), high-rejection (x0.85), unknown (x0.60).

## Quick Start

```bash
# Install dependencies
npm install

# Start infrastructure
docker compose -f infra/docker/docker-compose.yml up -d

# Run migrations
npm run migrate --workspace=apps/memory-service

# Build all services
npm run build

# Run tests
npm test
```

## Infrastructure

- **PostgreSQL** with pgvector for memory storage and vector search
- **Redis** for job queues (embedding, graph, lifecycle, consolidation, truth)
- **Neo4j** for memory relationship graph (optional, graph edges also in Postgres)

## Project Structure

```
hybrid-memory/
  apps/                    # Microservices
  packages/                # Shared libraries
  infra/                   # Docker, Helm, Terraform, K8s configs
  docs/                    # Architecture docs and runbooks
  eval/                    # Retrieval evaluation harness
  scripts/                 # Dev and deployment scripts
  storage/                 # Database schemas and configs
```

## License

MIT
