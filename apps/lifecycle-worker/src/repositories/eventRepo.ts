import { PoolClient } from "pg";
import { getPool } from "../db";

export type LifecycleEventType =
  | "accessed"
  | "reinforced"
  | "decayed"
  | "consolidated"
  | "archived"
  | "deleted"
  | "pinned"
  | "unpinned"
  | "restored";

export interface InsertEventParams {
  tenant_id: string;
  workspace_id: string;
  memory_id: string;
  event_type: LifecycleEventType;
  delta_stability?: number;
  delta_decay_rate?: number;
  metadata?: Record<string, unknown>;
}

export const eventRepo = {
  /**
   * Log a lifecycle event inside an existing transaction.
   */
  async logEvent(client: PoolClient, params: InsertEventParams): Promise<void> {
    await client.query(
      `INSERT INTO memory_events
         (tenant_id, workspace_id, memory_id, event_type,
          delta_stability, delta_decay_rate, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        params.tenant_id,
        params.workspace_id,
        params.memory_id,
        params.event_type,
        params.delta_stability ?? 0,
        params.delta_decay_rate ?? 0,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
  },

  /**
   * Batch log access events (fire-and-forget, no transaction needed).
   */
  async logAccessBatch(
    memoryIds: string[],
    tenantWorkspaceMap: Map<string, { tenant_id: string; workspace_id: string }>
  ): Promise<number> {
    if (memoryIds.length === 0) return 0;
    const pool = getPool();
    let count = 0;
    for (const memoryId of memoryIds) {
      const tw = tenantWorkspaceMap.get(memoryId);
      if (!tw) continue;
      await pool.query(
        `INSERT INTO memory_events
           (tenant_id, workspace_id, memory_id, event_type)
         VALUES ($1, $2, $3, 'accessed')`,
        [tw.tenant_id, tw.workspace_id, memoryId]
      );
      count++;
    }
    return count;
  },
};
