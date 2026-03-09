import { withTransaction } from "../db";
import { eventRepo } from "../repositories/eventRepo";
import { findExpiredMemories } from "../repositories/retentionRepo";
import { createLogger } from "@hybrid-memory/observability";
import { retentionDeletedCount, retentionSweepLatency } from "../observability/metrics";

const log = createLogger("lifecycle-worker", "retention");

/**
 * Scheduled retention sweep: soft-delete active memories that have exceeded
 * their retention period based on memory_type.
 *
 * Returns count of memories deleted.
 */
export async function runRetentionSweep(): Promise<number> {
  const start = Date.now();
  const BATCH_SIZE = 200;

  const candidates = await findExpiredMemories(BATCH_SIZE);

  if (candidates.length === 0) {
    log.info("no_expired_candidates");
    return 0;
  }

  let deleted = 0;

  for (const mem of candidates) {
    try {
      await withTransaction(async (client) => {
        // Soft-delete
        await client.query(
          `UPDATE memories
           SET status = 'deleted', deleted_at = now(), updated_at = now()
           WHERE memory_id = $1 AND status = 'active'`,
          [mem.memory_id]
        );

        // Purge embeddings so deleted memories don't appear in vector search
        await client.query(
          `DELETE FROM chunk_embeddings
           WHERE chunk_id IN (
             SELECT chunk_id FROM memory_chunks WHERE memory_id = $1
           )`,
          [mem.memory_id]
        );

        // Log deletion event for audit trail
        await eventRepo.logEvent(client, {
          tenant_id: mem.tenant_id,
          workspace_id: mem.workspace_id,
          memory_id: mem.memory_id,
          event_type: "deleted",
          metadata: {
            trigger: "retention_sweep",
            memory_type: mem.memory_type,
          },
        });
      });
      deleted++;
    } catch (err) {
      log.error("retention_delete_failed", {
        memory_id: mem.memory_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const elapsed = Date.now() - start;
  retentionDeletedCount.inc({}, deleted);
  retentionSweepLatency.observe(elapsed);
  log.info("retention_sweep_complete", {
    deleted,
    candidates: candidates.length,
    elapsed_ms: elapsed,
  });
  return deleted;
}
