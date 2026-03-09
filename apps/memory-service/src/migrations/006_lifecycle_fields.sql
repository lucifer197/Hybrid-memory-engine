-- 006_lifecycle_fields.sql — Add missing lifecycle columns to memories
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).

BEGIN;

-- pinned: prevents decay and archival
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

-- last_reinforced_at: rate-limits reinforcement frequency
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS last_reinforced_at TIMESTAMPTZ;

-- importance: user/agent-assigned priority (0..1)
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS importance DOUBLE PRECISION NOT NULL DEFAULT 0.5;

-- Index for lifecycle queries: find decayable/archivable memories efficiently
CREATE INDEX IF NOT EXISTS idx_memories_lifecycle
  ON memories (tenant_id, workspace_id, status, pinned, last_accessed_at);

-- Index for reinforcement rate-limiting
CREATE INDEX IF NOT EXISTS idx_memories_reinforcement
  ON memories (tenant_id, workspace_id, last_reinforced_at)
  WHERE status = 'active';

COMMIT;
