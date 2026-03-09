import { PoolClient } from "pg";
import { getPool } from "../db";

export interface MemoryRow {
  memory_id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  memory_type: string;
  content_raw: string;
  content_summary: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  stability_score: number;
  reinforcement_count: number;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_accessed_at: Date;
}

export const memoryRepo = {
  /**
   * Fetch a single memory by ID.
   */
  async findById(
    client: PoolClient,
    memoryId: string
  ): Promise<MemoryRow | null> {
    const { rows } = await client.query<MemoryRow>(
      `SELECT * FROM memories WHERE memory_id = $1`,
      [memoryId]
    );
    return rows[0] ?? null;
  },

  /**
   * Fetch recent unconsolidated memories for a workspace (no fact_evidence link yet).
   * Used by the scheduled sweep to catch memories that were not processed via queue.
   */
  async findUnconsolidated(
    tenantId: string,
    workspaceId: string,
    limit: number
  ): Promise<MemoryRow[]> {
    const { rows } = await getPool().query<MemoryRow>(
      `SELECT m.* FROM memories m
       LEFT JOIN fact_evidence fe ON fe.memory_id = m.memory_id
       WHERE m.tenant_id = $1
         AND m.workspace_id = $2
         AND m.status = 'active'
         AND m.memory_type IN ('episodic', 'preference', 'procedural')
         AND fe.memory_id IS NULL
       ORDER BY m.created_at ASC
       LIMIT $3`,
      [tenantId, workspaceId, limit]
    );
    return rows;
  },

  /**
   * Get distinct (tenant_id, workspace_id) pairs that have unconsolidated memories.
   */
  async findWorkspacesWithPending(
    limit: number
  ): Promise<Array<{ tenant_id: string; workspace_id: string }>> {
    const { rows } = await getPool().query<{
      tenant_id: string;
      workspace_id: string;
    }>(
      `SELECT DISTINCT m.tenant_id, m.workspace_id
       FROM memories m
       LEFT JOIN fact_evidence fe ON fe.memory_id = m.memory_id
       WHERE m.status = 'active'
         AND m.memory_type IN ('episodic', 'preference', 'procedural')
         AND fe.memory_id IS NULL
       LIMIT $1`,
      [limit]
    );
    return rows;
  },
};
