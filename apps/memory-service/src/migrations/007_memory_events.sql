-- 007_memory_events.sql — Audit log for memory lifecycle changes
-- Tracks every lifecycle mutation for debugging and compliance.

BEGIN;

CREATE TABLE IF NOT EXISTS memory_events (
  event_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  workspace_id      TEXT        NOT NULL,
  memory_id         UUID        NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  event_type        TEXT        NOT NULL
                                CHECK (event_type IN (
                                  'accessed', 'reinforced', 'decayed',
                                  'consolidated', 'archived', 'deleted',
                                  'pinned', 'unpinned', 'restored'
                                )),
  delta_stability   DOUBLE PRECISION NOT NULL DEFAULT 0,
  delta_decay_rate  DOUBLE PRECISION NOT NULL DEFAULT 0,
  metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup events for a specific memory
CREATE INDEX IF NOT EXISTS idx_memory_events_memory
  ON memory_events (tenant_id, workspace_id, memory_id, created_at DESC);

-- Time-range scans across a workspace (admin dashboards, audits)
CREATE INDEX IF NOT EXISTS idx_memory_events_time
  ON memory_events (tenant_id, workspace_id, created_at DESC);

COMMIT;
