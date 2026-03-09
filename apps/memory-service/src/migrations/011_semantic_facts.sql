-- 011_semantic_facts.sql — Canonical knowledge layer: stable facts distilled from episodic memory

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- semantic_facts — "clean truth" version of memory
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS semantic_facts (
  fact_id           UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT            NOT NULL,
  workspace_id      TEXT            NOT NULL,
  user_id           TEXT            NOT NULL,
  fact_type         TEXT            NOT NULL
                    CHECK (fact_type IN ('preference','profile','project','rule','note')),
  subject           TEXT            NOT NULL,
  predicate         TEXT            NOT NULL,
  value_text        TEXT            NOT NULL,
  value_json        JSONB,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0.5
                    CHECK (confidence >= 0 AND confidence <= 1),
  status            TEXT            NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','superseded','contested')),
  superseded_by     UUID            REFERENCES semantic_facts(fact_id) ON DELETE SET NULL,
  source            TEXT            CHECK (source IS NULL OR source IN ('user','assistant','tool')),
  metadata          JSONB           NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
  last_confirmed_at TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Tenant/workspace/user scoped lookups
CREATE INDEX IF NOT EXISTS idx_facts_scope
  ON semantic_facts (tenant_id, workspace_id, user_id);

-- Deduplicate & match: same subject+predicate within a workspace
CREATE INDEX IF NOT EXISTS idx_facts_subject_predicate
  ON semantic_facts (tenant_id, workspace_id, fact_type, subject, predicate);

-- Filter by status (retrieval queries only want active facts)
CREATE INDEX IF NOT EXISTS idx_facts_status
  ON semantic_facts (tenant_id, workspace_id, status)
  WHERE status = 'active';

COMMIT;
