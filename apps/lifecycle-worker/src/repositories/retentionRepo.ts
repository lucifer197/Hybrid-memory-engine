import { getPool } from "../db";

export interface ExpiredMemoryRow {
  memory_id: string;
  tenant_id: string;
  workspace_id: string;
  memory_type: string;
}

/**
 * Find active, non-pinned memories that have exceeded their retention period.
 *
 * Uses a sub-select on retention_config to get the effective max_age_hours
 * for each memory_type, preferring tenant-specific overrides over global
 * defaults (tenant='*', workspace='*').
 */
export async function findExpiredMemories(
  limit: number
): Promise<ExpiredMemoryRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ExpiredMemoryRow>(
    `SELECT m.memory_id, m.tenant_id, m.workspace_id, m.memory_type
     FROM memories m
     JOIN (
       SELECT DISTINCT ON (memory_type)
              memory_type, max_age_hours
       FROM retention_config
       ORDER BY memory_type,
                CASE WHEN tenant_id = '*' THEN 1 ELSE 0 END
     ) rc ON rc.memory_type = m.memory_type
     WHERE m.status = 'active'
       AND m.pinned = false
       AND m.created_at < now() - (rc.max_age_hours || ' hours')::interval
     ORDER BY m.created_at ASC
     LIMIT $1`,
    [limit]
  );
  return rows;
}
