import { PoolClient } from "pg";

export interface ForgetResult {
  memory_id: string;
  tenant_id: string;
  workspace_id: string;
}

export const forgetRepo = {
  /**
   * Soft-delete a single memory: set status='deleted', deleted_at=now().
   * Returns the deleted row info, or null if not found / already deleted.
   */
  async softDeleteById(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    memoryId: string
  ): Promise<ForgetResult | null> {
    const { rows } = await client.query<ForgetResult>(
      `UPDATE memories
       SET status = 'deleted', deleted_at = now(), updated_at = now()
       WHERE memory_id = $1
         AND tenant_id = $2
         AND workspace_id = $3
         AND status != 'deleted'
       RETURNING memory_id, tenant_id, workspace_id`,
      [memoryId, tenantId, workspaceId]
    );
    return rows[0] ?? null;
  },

  /**
   * Soft-delete all memories for a user within a workspace.
   */
  async softDeleteByUser(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    userId: string
  ): Promise<ForgetResult[]> {
    const { rows } = await client.query<ForgetResult>(
      `UPDATE memories
       SET status = 'deleted', deleted_at = now(), updated_at = now()
       WHERE tenant_id = $1
         AND workspace_id = $2
         AND user_id = $3
         AND status != 'deleted'
       RETURNING memory_id, tenant_id, workspace_id`,
      [tenantId, workspaceId, userId]
    );
    return rows;
  },

  /**
   * Remove chunk_embeddings for a set of memory_ids.
   * Explicit cleanup for soft-delete (FK cascade only fires on hard DELETE).
   */
  async purgeEmbeddings(
    client: PoolClient,
    memoryIds: string[]
  ): Promise<number> {
    if (memoryIds.length === 0) return 0;
    const { rowCount } = await client.query(
      `DELETE FROM chunk_embeddings
       WHERE chunk_id IN (
         SELECT chunk_id FROM memory_chunks
         WHERE memory_id = ANY($1)
       )`,
      [memoryIds]
    );
    return rowCount ?? 0;
  },
};
