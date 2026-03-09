import { PoolClient } from "pg";
import { EdgeType } from "@hybrid-memory/shared-types";

export interface UpsertEdgeParams {
  tenant_id: string;
  workspace_id: string;
  src_memory_id: string;
  dst_memory_id: string;
  edge_type: EdgeType;
  weight: number;
  metadata?: Record<string, unknown>;
}

export const edgeRepo = {
  /**
   * Idempotent edge upsert — updates weight if edge already exists.
   */
  async upsertEdge(
    client: PoolClient,
    params: UpsertEdgeParams
  ): Promise<void> {
    await client.query(
      `INSERT INTO memory_edges
         (tenant_id, workspace_id, src_memory_id, dst_memory_id, edge_type, weight, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (tenant_id, workspace_id, src_memory_id, dst_memory_id, edge_type)
       DO UPDATE SET weight = EXCLUDED.weight, metadata = EXCLUDED.metadata, updated_at = now()`,
      [
        params.tenant_id,
        params.workspace_id,
        params.src_memory_id,
        params.dst_memory_id,
        params.edge_type,
        params.weight,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
  },

  /**
   * Bulk upsert — wraps individual upserts for clarity.
   */
  async upsertEdges(
    client: PoolClient,
    edges: UpsertEdgeParams[]
  ): Promise<number> {
    for (const edge of edges) {
      await edgeRepo.upsertEdge(client, edge);
    }
    return edges.length;
  },

  /**
   * Count edges originating from a memory (for debugging/tests).
   */
  async countEdgesFrom(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    memoryId: string
  ): Promise<number> {
    const { rows } = await client.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM memory_edges
       WHERE tenant_id = $1 AND workspace_id = $2 AND src_memory_id = $3`,
      [tenantId, workspaceId, memoryId]
    );
    return parseInt(rows[0].cnt, 10);
  },
};
