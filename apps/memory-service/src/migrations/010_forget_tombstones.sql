-- 010_forget_tombstones.sql — Forget/tombstone support + retention config + privacy index

BEGIN;

-- ── A) Add deleted_at timestamp for tombstone tracking ─────────
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ── B) Index for finding tombstoned rows for eventual hard-delete purge ──
CREATE INDEX IF NOT EXISTS idx_memories_deleted
  ON memories (tenant_id, workspace_id, deleted_at)
  WHERE status = 'deleted';

-- ── C) Privacy scope index for efficient filtering ─────────────
CREATE INDEX IF NOT EXISTS idx_memories_privacy_scope
  ON memories (tenant_id, workspace_id, privacy_scope, user_id);

-- ── D) Retention configuration table ───────────────────────────
CREATE TABLE IF NOT EXISTS retention_config (
  id              BIGSERIAL       PRIMARY KEY,
  tenant_id       TEXT            NOT NULL,
  workspace_id    TEXT            NOT NULL,
  memory_type     TEXT            NOT NULL
                  CHECK (memory_type IN ('working','episodic','semantic','procedural','preference')),
  max_age_hours   INTEGER         NOT NULL,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT uq_retention_config_type
    UNIQUE (tenant_id, workspace_id, memory_type)
);

CREATE INDEX IF NOT EXISTS idx_retention_config_lookup
  ON retention_config (tenant_id, workspace_id);

-- ── E) Seed default retention values (global defaults: tenant='*', workspace='*') ──
INSERT INTO retention_config (tenant_id, workspace_id, memory_type, max_age_hours) VALUES
  ('*', '*', 'working',     72),        -- 3 days
  ('*', '*', 'episodic',    2160),      -- 90 days (3 months)
  ('*', '*', 'semantic',    17520),     -- 2 years
  ('*', '*', 'procedural',  17520),     -- 2 years
  ('*', '*', 'preference',  87600)      -- 10 years (effectively permanent)
ON CONFLICT (tenant_id, workspace_id, memory_type) DO NOTHING;

COMMIT;
