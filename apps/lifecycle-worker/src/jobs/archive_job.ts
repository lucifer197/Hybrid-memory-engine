import { withTransaction } from "../db";
import { memoryRepo } from "../repositories/memoryRepo";
import { eventRepo } from "../repositories/eventRepo";
import { getEnv } from "../config/env";
import { createLogger } from "@hybrid-memory/observability";
import { archivedCount, archiveSweepLatency } from "../observability/metrics";

const log = createLogger("lifecycle-worker", "archive");

/**
 * Scheduled archival sweep: move low-stability, long-idle memories to archived status.
 * Returns count of memories archived.
 */
export async function runArchiveSweep(): Promise<number> {
  const env = getEnv();
  const start = Date.now();

  const candidates = await memoryRepo.findArchivable(
    env.ARCHIVE_STABILITY_THRESHOLD,
    env.ARCHIVE_MIN_IDLE_DAYS,
    env.ARCHIVE_BATCH_SIZE
  );

  if (candidates.length === 0) {
    log.info("no_candidates");
    return 0;
  }

  let archived = 0;

  for (const mem of candidates) {
    try {
      await withTransaction(async (client) => {
        await memoryRepo.archive(client, mem.memory_id);

        await eventRepo.logEvent(client, {
          tenant_id: mem.tenant_id,
          workspace_id: mem.workspace_id,
          memory_id: mem.memory_id,
          event_type: "archived",
          metadata: {
            stability_score: mem.stability_score,
            reinforcement_count: mem.reinforcement_count,
            idle_days: Math.round(
              (Date.now() - mem.last_accessed_at.getTime()) / 86_400_000
            ),
            age_days: Math.round(
              (Date.now() - mem.created_at.getTime()) / 86_400_000
            ),
          },
        });
      });
      archived++;
    } catch (err) {
      log.error("archive_failed", {
        memory_id: mem.memory_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const elapsed = Date.now() - start;
  archivedCount.inc({}, archived);
  archiveSweepLatency.observe(elapsed);
  log.info("sweep_complete", {
    archived,
    candidates: candidates.length,
    elapsed_ms: elapsed,
  });
  return archived;
}
