import { PoolClient } from "pg";
import type { ForgetRequest, ForgetResponse } from "@hybrid-memory/shared-types";
import { withTransaction } from "../db";
import { forgetRepo } from "../repositories/forgetRepo";
import { logger } from "../observability/logger";
import { forgetLatency, forgetDeletedCount } from "../observability/metrics";

const log = logger.child("forget");

/**
 * Forget (soft-delete) memories by ID or by user.
 *
 * Within a single transaction:
 *   1. Soft-delete matching memories (status='deleted', deleted_at=now())
 *   2. Purge chunk_embeddings so they don't appear in vector search
 *   3. Log 'deleted' events for audit trail
 */
export async function forgetMemories(
  req: ForgetRequest
): Promise<ForgetResponse> {
  const start = performance.now();

  const result = await withTransaction<ForgetResponse>(
    async (client: PoolClient) => {
      let deletedMemories: Array<{
        memory_id: string;
        tenant_id: string;
        workspace_id: string;
      }>;

      if (req.memory_id) {
        const row = await forgetRepo.softDeleteById(
          client,
          req.tenant_id,
          req.workspace_id,
          req.memory_id
        );
        deletedMemories = row ? [row] : [];
      } else if (req.user_id) {
        deletedMemories = await forgetRepo.softDeleteByUser(
          client,
          req.tenant_id,
          req.workspace_id,
          req.user_id
        );
      } else {
        deletedMemories = [];
      }

      if (deletedMemories.length === 0) {
        return { deleted_count: 0, memory_ids: [] };
      }

      const memoryIds = deletedMemories.map((m) => m.memory_id);

      // Purge embeddings so deleted memories don't appear in vector search
      const purged = await forgetRepo.purgeEmbeddings(client, memoryIds);
      log.info("embeddings_purged", { count: purged, memory_ids: memoryIds });

      // Log deletion events for compliance audit trail
      for (const mem of deletedMemories) {
        await client.query(
          `INSERT INTO memory_events
             (tenant_id, workspace_id, memory_id, event_type, metadata)
           VALUES ($1, $2, $3, 'deleted', $4::jsonb)`,
          [
            mem.tenant_id,
            mem.workspace_id,
            mem.memory_id,
            JSON.stringify({
              reason: req.reason ?? "user_request",
              user_id: req.user_id,
              triggered_by: req.memory_id ? "by_memory_id" : "by_user_id",
            }),
          ]
        );
      }

      return {
        deleted_count: deletedMemories.length,
        memory_ids: memoryIds,
      };
    }
  );

  forgetLatency.observe(performance.now() - start);
  if (result.deleted_count > 0) {
    forgetDeletedCount.inc({}, result.deleted_count);
  }

  log.info("forget_complete", {
    deleted_count: result.deleted_count,
    memory_ids: result.memory_ids,
  });

  return result;
}
