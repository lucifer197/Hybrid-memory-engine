import { withTransaction } from "../db";
import { memoryRepo } from "../repositories/memoryRepo";
import {
  batchApplyDecay,
  batchArchive,
  batchInsertEvents,
} from "../repositories/batchRepo";
import { getEnv } from "../config/env";
import { createLogger } from "@hybrid-memory/observability";
import { decayProcessed, archivedCount, decaySweepLatency } from "../observability/metrics";

const log = createLogger("lifecycle-worker", "decay");

/**
 * Scheduled decay sweep: reduce stability of idle, non-pinned memories.
 *
 * Processes the entire batch in a single transaction using batch UPDATE
 * and batch INSERT for events, reducing round-trips from O(N) to O(1).
 *
 * Returns count of memories decayed.
 */
export async function runDecaySweep(): Promise<number> {
  const env = getEnv();
  const start = Date.now();

  const candidates = await memoryRepo.findDecayable(
    env.DECAY_MIN_IDLE_HOURS,
    env.DECAY_STABILITY_FLOOR
  );

  if (candidates.length === 0) {
    log.info("no_candidates");
    return 0;
  }

  let decayed = 0;
  let archived = 0;

  try {
    await withTransaction(async (client) => {
      // ── 1. Batch decay all candidates ──────────────────────
      const targets = candidates.map((mem) => ({
        memory_id: mem.memory_id,
        is_episodic: mem.memory_type === "episodic",
      }));

      const results = await batchApplyDecay(
        client,
        targets,
        env.DECAY_STABILITY_FLOOR
      );

      // Index results by memory_id for quick lookup
      const resultMap = new Map(results.map((r) => [r.memory_id, r]));

      // ── 2. Build events + identify archival candidates ─────
      const decayEvents = [];
      const archiveEvents = [];
      const archiveIds: string[] = [];

      for (const mem of candidates) {
        const result = resultMap.get(mem.memory_id);
        if (!result) continue;

        const idleDays = Math.round(
          (Date.now() - mem.last_accessed_at.getTime()) / 86_400_000
        );

        decayEvents.push({
          tenant_id: mem.tenant_id,
          workspace_id: mem.workspace_id,
          memory_id: mem.memory_id,
          event_type: "decayed",
          delta_stability: result.new_stability - result.old_stability,
          metadata: {
            old_stability: result.old_stability,
            new_stability: result.new_stability,
            decay_rate: result.new_decay_rate,
            memory_type: mem.memory_type,
            idle_days: idleDays,
          },
        });

        // Check if should auto-archive
        if (
          result.new_stability < env.DECAY_ARCHIVE_STABILITY &&
          idleDays >= env.DECAY_ARCHIVE_MIN_AGE_DAYS
        ) {
          archiveIds.push(mem.memory_id);
          archiveEvents.push({
            tenant_id: mem.tenant_id,
            workspace_id: mem.workspace_id,
            memory_id: mem.memory_id,
            event_type: "archived",
            metadata: {
              trigger: "decay_sweep",
              stability_score: result.new_stability,
              idle_days: idleDays,
            },
          });
        }
      }

      decayed = results.length;

      // ── 3. Batch archive ───────────────────────────────────
      if (archiveIds.length > 0) {
        archived = await batchArchive(client, archiveIds);
        archivedCount.inc({}, archived);
      }

      // ── 4. Batch insert all events ─────────────────────────
      await batchInsertEvents(client, [...decayEvents, ...archiveEvents]);
    });
  } catch (err) {
    log.error("decay_batch_failed", {
      error: err instanceof Error ? err.message : String(err),
      candidates: candidates.length,
    });
  }

  const elapsed = Date.now() - start;
  decayProcessed.inc({}, decayed);
  decaySweepLatency.observe(elapsed);
  log.info("sweep_complete", {
    decayed,
    candidates: candidates.length,
    archived,
    elapsed_ms: elapsed,
  });
  return decayed;
}
