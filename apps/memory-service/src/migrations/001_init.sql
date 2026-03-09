-- 001_init.sql — Canonical storage for hybrid-memory
-- Run once against a fresh Postgres database.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- A) turn_writes  — idempotency ledger
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS turn_writes (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     TEXT        NOT NULL,
  workspace_id  TEXT        NOT NULL,
  session_id    TEXT        NOT NULL,
  turn_id       TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'processing'
                            CHECK (status IN ('processing', 'complete', 'failed')),
  request_hash  TEXT,
  memory_ids    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_turn_writes_key
    UNIQUE (tenant_id, workspace_id, session_id, turn_id)
);

-- ══════════════════════════════════════════════════════════════
-- B) memories  — canonical memory objects
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memories (
  memory_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT        NOT NULL,
  workspace_id        TEXT        NOT NULL,
  user_id             TEXT        NOT NULL,
  agent_id            TEXT,
  session_id          TEXT,
  turn_id             TEXT,
  memory_type         TEXT        NOT NULL DEFAULT 'episodic'
                                  CHECK (memory_type IN (
                                    'working','episodic','semantic','procedural','preference'
                                  )),
  content_raw         TEXT        NOT NULL,
  content_summary     TEXT,
  privacy_scope       TEXT        NOT NULL DEFAULT 'private'
                                  CHECK (privacy_scope IN ('private','workspace','tenant')),
  tags                JSONB       NOT NULL DEFAULT '[]'::jsonb,
  metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  stability_score     DOUBLE PRECISION NOT NULL DEFAULT 0.2,
  decay_rate          DOUBLE PRECISION NOT NULL DEFAULT 0.01,
  reinforcement_count INTEGER     NOT NULL DEFAULT 0,
  status              TEXT        NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','archived','deleted')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- C) memory_chunks  — retrieval units
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS memory_chunks (
  chunk_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id   UUID        NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  chunk_index INTEGER     NOT NULL,
  chunk_text  TEXT        NOT NULL,
  token_count INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_chunk_memory_index
    UNIQUE (memory_id, chunk_index)
);

COMMIT;
