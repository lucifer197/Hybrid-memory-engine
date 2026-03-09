import { PoolClient } from "pg";
import { EdgeType } from "@hybrid-memory/shared-types";

export const edgeRepo = {
  /**
   * Insert a `consolidated_into` edge from each source memory to the
   * target consolidated semantic memory.
   *
   * Uses ON CONFLICT DO NOTHING to be idempotent.
   */
  async insertConsolidatedIntoEdges(
    client: PoolClient,
    params: {
      tenant_id: string;
      workspace_id: string;
      source_memory_ids: string[];
      target_memory_id: string;
      weight: number;
    }
  ): Promise<void> {
    for (const srcId of params.source_memory_ids) {
      await client.query(
        `INSERT INTO memory_edges
           (tenant_id, workspace_id, src_memory_id, dst_memory_id,
            edge_type, weight)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, workspace_id, src_memory_id, dst_memory_id, edge_type)
         DO NOTHING`,
        [
          params.tenant_id,
          params.workspace_id,
          srcId,
          params.target_memory_id,
          EdgeType.ConsolidatedInto,
          params.weight,
        ]
      );
    }
  },
};
