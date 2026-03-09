import { PoolClient } from "pg";

export interface InsertEntityParams {
  tenant_id: string;
  workspace_id: string;
  memory_id: string;
  entity_type: string;
  entity_value: string;
  confidence: number;
}

export const entityRepo = {
  /**
   * Idempotent entity insert (skip on duplicate).
   */
  async upsertEntity(
    client: PoolClient,
    params: InsertEntityParams
  ): Promise<void> {
    await client.query(
      `INSERT INTO memory_entities
         (tenant_id, workspace_id, memory_id, entity_type, entity_value, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, workspace_id, memory_id, entity_type, entity_value)
       DO NOTHING`,
      [
        params.tenant_id,
        params.workspace_id,
        params.memory_id,
        params.entity_type,
        params.entity_value,
        params.confidence,
      ]
    );
  },

  async upsertEntities(
    client: PoolClient,
    entities: InsertEntityParams[]
  ): Promise<number> {
    for (const e of entities) {
      await entityRepo.upsertEntity(client, e);
    }
    return entities.length;
  },

  /**
   * Find all memory_ids that share at least one entity_value with the given memory,
   * within the same tenant/workspace. Excludes the memory itself.
   */
  async findMemoriesSharingEntities(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    memoryId: string
  ): Promise<{ memory_id: string; shared_values: string[]; max_confidence: number }[]> {
    const { rows } = await client.query<{
      memory_id: string;
      shared_values: string[];
      max_confidence: number;
    }>(
      `SELECT
         other.memory_id,
         array_agg(DISTINCT other.entity_value) AS shared_values,
         MAX(LEAST(mine.confidence, other.confidence)) AS max_confidence
       FROM memory_entities mine
       JOIN memory_entities other
         ON other.tenant_id = mine.tenant_id
        AND other.workspace_id = mine.workspace_id
        AND other.entity_value = mine.entity_value
        AND other.memory_id != mine.memory_id
       WHERE mine.tenant_id = $1
         AND mine.workspace_id = $2
         AND mine.memory_id = $3
       GROUP BY other.memory_id
       ORDER BY max_confidence DESC`,
      [tenantId, workspaceId, memoryId]
    );
    return rows;
  },
};
