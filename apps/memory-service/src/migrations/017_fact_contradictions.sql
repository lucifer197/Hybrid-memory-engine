-- 017_fact_contradictions.sql — Explicit contradiction pairs with resolution tracking

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- fact_contradictions — connects two facts that conflict
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fact_contradictions (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT            NOT NULL,
  workspace_id        TEXT            NOT NULL,
  fact_a_id           UUID            NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  fact_b_id           UUID            NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  contradiction_type  TEXT            NOT NULL
                      CHECK (contradiction_type IN ('direct','soft','override')),
  resolution          TEXT            NOT NULL DEFAULT 'unresolved'
                      CHECK (resolution IN ('unresolved','superseded','contested','merged')),
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  metadata            JSONB           NOT NULL DEFAULT '{}'::jsonb,

  -- Prevent duplicate contradiction pairs (order-independent)
  CONSTRAINT uq_contradiction_pair UNIQUE (tenant_id, workspace_id, fact_a_id, fact_b_id)
);

-- Lookup contradictions involving a specific fact
CREATE INDEX IF NOT EXISTS idx_fact_contradictions_a
  ON fact_contradictions (tenant_id, workspace_id, fact_a_id);

CREATE INDEX IF NOT EXISTS idx_fact_contradictions_b
  ON fact_contradictions (tenant_id, workspace_id, fact_b_id);

-- Find unresolved contradictions for a workspace
CREATE INDEX IF NOT EXISTS idx_fact_contradictions_unresolved
  ON fact_contradictions (tenant_id, workspace_id, resolution)
  WHERE resolution = 'unresolved';

COMMIT;
