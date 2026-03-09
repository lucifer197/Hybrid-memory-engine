import { getPool } from "../db";
import { EdgeType } from "@hybrid-memory/shared-types";

export interface EdgeRow {
  src_memory_id: string;
  dst_memory_id: string;
  edge_type: EdgeType;
  weight: number;
}

/**
 * Fetch outgoing edges from a set of seed memory IDs.
 * Returns edges ordered by weight DESC so callers can take top-N.
 * Tenant/workspace scoped.
 */
export async function fetchEdgesFromSeeds(
  tenantId: string,
  workspaceId: string,
  seedMemoryIds: string[],
  maxPerSeed: number
): Promise<EdgeRow[]> {
  if (seedMemoryIds.length === 0) return [];

  const pool = getPool();

  // Use a lateral join to get top-N neighbors per seed efficiently
  const { rows } = await pool.query<EdgeRow>(
    `SELECT e.src_memory_id, e.dst_memory_id, e.edge_type, e.weight
     FROM unnest($1::uuid[]) AS seed(id)
     CROSS JOIN LATERAL (
       SELECT src_memory_id, dst_memory_id, edge_type, weight
       FROM memory_edges
       WHERE tenant_id = $2
         AND workspace_id = $3
         AND src_memory_id = seed.id
       ORDER BY weight DESC
       LIMIT $4
     ) e`,
    [seedMemoryIds, tenantId, workspaceId, maxPerSeed]
  );

  return rows;
}
