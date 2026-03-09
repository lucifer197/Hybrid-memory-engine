-- 013_fact_events.sql — Audit log for knowledge layer changes (enterprise explainability)

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- fact_events — immutable audit trail for fact lifecycle
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fact_events (
  event_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     TEXT        NOT NULL,
  workspace_id  TEXT        NOT NULL,
  fact_id       UUID        NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  event_type    TEXT        NOT NULL
                CHECK (event_type IN (
                  'created','updated','reinforced','superseded','contested','merged'
                )),
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lookup events for a specific fact
CREATE INDEX IF NOT EXISTS idx_fact_events_fact
  ON fact_events (fact_id, created_at DESC);

-- Workspace-level audit queries
CREATE INDEX IF NOT EXISTS idx_fact_events_workspace
  ON fact_events (tenant_id, workspace_id, created_at DESC);

COMMIT;
