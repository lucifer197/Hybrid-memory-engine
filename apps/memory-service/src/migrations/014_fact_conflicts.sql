-- 014_fact_conflicts.sql — Explicit contradiction tracking for belief revision

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- fact_conflicts — tracks contradictions between facts
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fact_conflicts (
  conflict_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL,
  workspace_id  TEXT        NOT NULL,
  old_fact_id   UUID        NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  new_fact_id   UUID        NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  conflict_type TEXT        NOT NULL
                CHECK (conflict_type IN ('contradiction','override','uncertainty')),
  resolution    TEXT        NOT NULL DEFAULT 'manual_required'
                CHECK (resolution IN ('superseded','contested','manual_required')),
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup conflicts by workspace
CREATE INDEX IF NOT EXISTS idx_fact_conflicts_workspace
  ON fact_conflicts (tenant_id, workspace_id, created_at DESC);

-- Lookup conflicts involving a specific fact (either side)
CREATE INDEX IF NOT EXISTS idx_fact_conflicts_old
  ON fact_conflicts (old_fact_id);

CREATE INDEX IF NOT EXISTS idx_fact_conflicts_new
  ON fact_conflicts (new_fact_id);

-- Find unresolved conflicts
CREATE INDEX IF NOT EXISTS idx_fact_conflicts_unresolved
  ON fact_conflicts (tenant_id, workspace_id, resolution)
  WHERE resolution = 'manual_required';

COMMIT;
