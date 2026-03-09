-- 002_indexes.sql — Performance indexes

BEGIN;

-- memories: multi-tenant lookup
CREATE INDEX IF NOT EXISTS idx_memories_tenant_workspace_user
  ON memories (tenant_id, workspace_id, user_id);

-- memories: session scoped queries
CREATE INDEX IF NOT EXISTS idx_memories_tenant_workspace_session
  ON memories (tenant_id, workspace_id, session_id)
  WHERE session_id IS NOT NULL;

-- memories: chronological ordering
CREATE INDEX IF NOT EXISTS idx_memories_created_at
  ON memories (created_at DESC);

-- memories: active-only filter (most queries exclude archived/deleted)
CREATE INDEX IF NOT EXISTS idx_memories_status
  ON memories (status)
  WHERE status = 'active';

-- memory_chunks: parent lookup
CREATE INDEX IF NOT EXISTS idx_chunks_memory_id
  ON memory_chunks (memory_id);

COMMIT;
