-- 008_consolidation_tables.sql — Links consolidated semantic memories
-- to their source episodic memories.

BEGIN;

CREATE TABLE IF NOT EXISTS memory_consolidations (
  consolidation_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  workspace_id      TEXT        NOT NULL,
  target_memory_id  UUID        NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  source_memory_ids JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup consolidations by target (the merged memory)
CREATE INDEX IF NOT EXISTS idx_consolidations_target
  ON memory_consolidations (tenant_id, workspace_id, target_memory_id);

-- Lookup consolidations by workspace (admin/audit)
CREATE INDEX IF NOT EXISTS idx_consolidations_workspace
  ON memory_consolidations (tenant_id, workspace_id, created_at DESC);

COMMIT;
