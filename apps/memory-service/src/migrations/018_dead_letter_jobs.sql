-- Dead letter queue table for persistent failure tracking
CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type      TEXT NOT NULL,
  queue_name    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  error_message TEXT NOT NULL DEFAULT '',
  stack_trace   TEXT NOT NULL DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   TEXT
);

CREATE INDEX idx_dlj_job_type ON dead_letter_jobs (job_type);
CREATE INDEX idx_dlj_queue_name ON dead_letter_jobs (queue_name);
CREATE INDEX idx_dlj_created_at ON dead_letter_jobs (created_at DESC);
CREATE INDEX idx_dlj_unresolved ON dead_letter_jobs (resolved_at) WHERE resolved_at IS NULL;
