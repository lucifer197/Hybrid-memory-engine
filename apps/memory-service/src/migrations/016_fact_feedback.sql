-- 016_fact_feedback.sql — First-class user feedback on facts (confirm / reject / correct)

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- fact_feedback — every confirmation, rejection, or correction
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fact_feedback (
  feedback_id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT            NOT NULL,
  workspace_id          TEXT            NOT NULL,
  user_id               TEXT            NOT NULL,
  fact_id               UUID            NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  feedback_type         TEXT            NOT NULL
                        CHECK (feedback_type IN ('confirm','reject','correct')),
  correction_value_text TEXT,           -- only populated when feedback_type = 'correct'
  created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
  metadata              JSONB           NOT NULL DEFAULT '{}'::jsonb
);

-- Lookup feedback for a specific fact
CREATE INDEX IF NOT EXISTS idx_fact_feedback_fact
  ON fact_feedback (tenant_id, workspace_id, fact_id);

-- Lookup feedback by user (audit trail / analytics)
CREATE INDEX IF NOT EXISTS idx_fact_feedback_user
  ON fact_feedback (tenant_id, workspace_id, user_id, created_at DESC);

COMMIT;
