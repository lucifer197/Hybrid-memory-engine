-- 004_embeddings.sql — Chunk embeddings table for vector search

BEGIN;

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id        UUID        NOT NULL REFERENCES memory_chunks(chunk_id) ON DELETE CASCADE,
  tenant_id       TEXT        NOT NULL,
  workspace_id    TEXT        NOT NULL,
  embedding_model TEXT        NOT NULL DEFAULT 'text-embedding-3-small',
  embedding_dim   INTEGER     NOT NULL DEFAULT 1536,
  embedding       vector(1536) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_chunk_embeddings PRIMARY KEY (chunk_id)
);

-- Vector similarity index (HNSW — no training data needed)
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_vector
  ON chunk_embeddings USING hnsw (embedding vector_cosine_ops);

-- Tenant/workspace scoping
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_tenant_workspace
  ON chunk_embeddings (tenant_id, workspace_id);

COMMIT;
