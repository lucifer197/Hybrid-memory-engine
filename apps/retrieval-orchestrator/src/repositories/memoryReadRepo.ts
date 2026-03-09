import { getPool } from "../db";

export interface MemoryRow {
  memory_id: string;
  memory_type: string;
  status: string;
  content_raw: string;
  content_summary: string | null;
  created_at: Date;
  metadata: Record<string, unknown>;
  stability_score: number;
  importance: number;
  last_accessed_at: Date;
  pinned: boolean;
}

export async function getMemoriesByIds(
  tenantId: string,
  workspaceId: string,
  userId: string,
  memoryIds: string[]
): Promise<MemoryRow[]> {
  if (memoryIds.length === 0) return [];

  const pool = getPool();
  const { rows } = await pool.query<MemoryRow>(
    `SELECT memory_id, memory_type, status,
            LEFT(content_raw, 500) AS content_raw,
            content_summary,
            created_at, metadata, stability_score,
            COALESCE(importance, 0) AS importance,
            COALESCE(last_accessed_at, created_at) AS last_accessed_at,
            COALESCE(pinned, false) AS pinned
     FROM memories
     WHERE memory_id = ANY($1)
       AND tenant_id = $2
       AND workspace_id = $3
       AND (privacy_scope != 'private' OR user_id = $4)
       AND status IN ('active', 'archived')`,
    [memoryIds, tenantId, workspaceId, userId]
  );
  return rows;
}
