-- 003_pgvector.sql — Enable pgvector extension

BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

COMMIT;
