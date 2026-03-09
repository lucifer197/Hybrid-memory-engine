-- 015_truth_fields.sql — Extend semantic_facts with trust & verification metadata

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- New columns on semantic_facts for the Truth Layer
-- ══════════════════════════════════════════════════════════════

-- Source type: who produced this fact?
ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'assistant'
  CHECK (source_type IN ('user','assistant','tool','system'));

-- Trust score: composite score combining source trust + verification history
ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS trust_score DOUBLE PRECISION NOT NULL DEFAULT 0.5
  CHECK (trust_score >= 0 AND trust_score <= 1);

-- Verification counters
ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS verification_count INT NOT NULL DEFAULT 0;

ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS rejection_count INT NOT NULL DEFAULT 0;

ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS contradiction_count INT NOT NULL DEFAULT 0;

-- Verification timestamps
ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ;

ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS last_rejected_at TIMESTAMPTZ;

-- Truth status: separate from operational status for cleaner semantics
-- active    = believed true
-- contested = contradicted but not yet resolved
-- superseded = replaced by a newer fact
-- unknown   = insufficient evidence to judge
ALTER TABLE semantic_facts
  ADD COLUMN IF NOT EXISTS truth_status TEXT NOT NULL DEFAULT 'active'
  CHECK (truth_status IN ('active','contested','superseded','unknown'));

-- ── Backfill existing rows ───────────────────────────────────
-- Sync truth_status from existing status column
UPDATE semantic_facts SET truth_status = status WHERE truth_status = 'active' AND status <> 'active';

-- Derive source_type from existing source column where available
UPDATE semantic_facts SET source_type = source WHERE source IS NOT NULL AND source IN ('user','assistant','tool');

-- Derive initial trust_score from source_type + confidence
UPDATE semantic_facts SET trust_score = CASE
  WHEN source_type = 'user' THEN LEAST(confidence + 0.15, 1.0)
  WHEN source_type = 'tool' THEN LEAST(confidence + 0.10, 1.0)
  WHEN source_type = 'system' THEN LEAST(confidence + 0.10, 1.0)
  ELSE confidence
END;

-- ── Indexes ──────────────────────────────────────────────────

-- Retrieve verified facts first
CREATE INDEX IF NOT EXISTS idx_facts_trust
  ON semantic_facts (tenant_id, workspace_id, user_id, trust_score DESC)
  WHERE truth_status = 'active';

-- Find contested / unknown facts needing resolution
CREATE INDEX IF NOT EXISTS idx_facts_truth_status
  ON semantic_facts (tenant_id, workspace_id, truth_status)
  WHERE truth_status IN ('contested','unknown');

COMMIT;
