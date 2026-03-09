-- 005_graph_tables.sql — Graph layer: edges between memories + entity extraction

BEGIN;

-- ════════════════════════════════════════════════════════════
-- A) memory_edges — directed weighted edges between memories
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memory_edges (
  edge_id         UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT          NOT NULL,
  workspace_id    TEXT          NOT NULL,
  src_memory_id   UUID          NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  dst_memory_id   UUID          NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  edge_type       TEXT          NOT NULL,
  weight          DOUBLE PRECISION NOT NULL DEFAULT 0.5
                  CHECK (weight >= 0 AND weight <= 1),
  metadata        JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Prevent duplicate edges of same type between same pair
  CONSTRAINT uq_edge_type_pair
    UNIQUE (tenant_id, workspace_id, src_memory_id, dst_memory_id, edge_type),

  -- Prevent self-edges
  CONSTRAINT chk_no_self_edge
    CHECK (src_memory_id != dst_memory_id)
);

-- Outbound traversal: "given src, find all dst"
CREATE INDEX IF NOT EXISTS idx_edges_src
  ON memory_edges (tenant_id, workspace_id, src_memory_id);

-- Inbound traversal: "given dst, find all src"
CREATE INDEX IF NOT EXISTS idx_edges_dst
  ON memory_edges (tenant_id, workspace_id, dst_memory_id);

-- Filter by edge type within a tenant/workspace
CREATE INDEX IF NOT EXISTS idx_edges_type
  ON memory_edges (tenant_id, workspace_id, edge_type);

-- Compound: outbound + type (most common traversal pattern)
CREATE INDEX IF NOT EXISTS idx_edges_src_type
  ON memory_edges (tenant_id, workspace_id, src_memory_id, edge_type);


-- ════════════════════════════════════════════════════════════
-- B) memory_entities — extracted entities per memory
--    Makes "shares_entity" edges deterministic and cheap
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS memory_entities (
  id              BIGSERIAL     PRIMARY KEY,
  tenant_id       TEXT          NOT NULL,
  workspace_id    TEXT          NOT NULL,
  memory_id       UUID          NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  entity_type     TEXT          NOT NULL,
  entity_value    TEXT          NOT NULL,
  confidence      DOUBLE PRECISION NOT NULL DEFAULT 1.0
                  CHECK (confidence >= 0 AND confidence <= 1),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Look up all memories that share a given entity value
CREATE INDEX IF NOT EXISTS idx_entities_value
  ON memory_entities (tenant_id, workspace_id, entity_value);

-- Look up all entities for a given memory
CREATE INDEX IF NOT EXISTS idx_entities_memory
  ON memory_entities (tenant_id, workspace_id, memory_id);

-- Prevent exact duplicate entity extractions for same memory
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_per_memory
  ON memory_entities (tenant_id, workspace_id, memory_id, entity_type, entity_value);

COMMIT;
