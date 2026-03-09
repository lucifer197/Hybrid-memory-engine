import type { ReinforceJob } from "@hybrid-memory/shared-types";
import { withTransaction } from "../db";
import { memoryRepo } from "../repositories/memoryRepo";
import { eventRepo } from "../repositories/eventRepo";
import {
  batchCheckCooldowns,
  batchReinforce,
  batchInsertReinforceEvents,
} from "../repositories/batchUpdates";
import { getEnv } from "../config/env";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("lifecycle-worker", "reinforce");

// ── Type-aware delta rules ──────────────────────────────────
const DELTA_EPISODIC = 0.03;
const DELTA_SEMANTIC = 0.01;

function getDelta(memoryType: string): number {
  return memoryType === "semantic" ? DELTA_SEMANTIC : DELTA_EPISODIC;
}

/**
 * Reinforce a single memory (fallback path for error recovery).
 * Respects cooldown to avoid over-reinforcing on repeated queries.
 */
export async function reinforceMemory(
  memoryId: string,
  memoryType: string,
  tenantId: string,
  workspaceId: string
): Promise<boolean> {
  const env = getEnv();

  // Check cooldown
  const recent = await memoryRepo.wasRecentlyReinforced(
    memoryId,
    env.REINFORCE_COOLDOWN_SEC
  );
  if (recent) return false;

  const delta = getDelta(memoryType);

  const result = await withTransaction(async (client) => {
    const { old_stability, new_stability } = await memoryRepo.reinforce(
      client,
      memoryId,
      delta,
      env.REINFORCE_STABILITY_CAP
    );

    await eventRepo.logEvent(client, {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      memory_id: memoryId,
      event_type: "reinforced",
      delta_stability: new_stability - old_stability,
      metadata: {
        old_stability,
        new_stability,
        reinforcement_delta: delta,
        memory_type: memoryType,
      },
    });

    return { old_stability, new_stability };
  });

  log.info("reinforced", {
    memory_id: memoryId,
    memory_type: memoryType,
    delta,
    old_stability: result.old_stability,
    new_stability: result.new_stability,
  });
  return true;
}

/**
 * Process a batch reinforcement job from the queue.
 *
 * Uses batch operations for efficiency:
 *  1. Batch cooldown check (single query)
 *  2. Batch stability update (single UPDATE with unnest)
 *  3. Batch event logging (multi-row INSERT)
 *
 * Falls back to per-memory processing if batch fails.
 */
export async function processReinforceJob(job: ReinforceJob): Promise<void> {
  const env = getEnv();
  const allIds = job.memories.map((m) => m.memory_id);

  try {
    // 1. Batch cooldown check
    const coolingDown = await batchCheckCooldowns(allIds, env.REINFORCE_COOLDOWN_SEC);

    // 2. Filter to eligible memories
    const eligible = job.memories.filter((m) => !coolingDown.has(m.memory_id));

    if (eligible.length === 0) {
      log.info("job_complete", { reinforced: 0, total: job.memories.length, skipped_cooldown: coolingDown.size });
      return;
    }

    // 3. Build batch params
    const batchParams = eligible.map((m) => ({
      memory_id: m.memory_id,
      delta: getDelta(m.memory_type),
      cap: env.REINFORCE_STABILITY_CAP,
    }));

    const events = eligible.map((m) => ({
      tenant_id: job.tenant_id,
      workspace_id: job.workspace_id,
      memory_id: m.memory_id,
      delta_stability: getDelta(m.memory_type),
      metadata: {
        reinforcement_delta: getDelta(m.memory_type),
        memory_type: m.memory_type,
      },
    }));

    // 4. Batch reinforce + events in one transaction
    await withTransaction(async (client) => {
      await batchReinforce(client, batchParams);
      await batchInsertReinforceEvents(client, events);
    });

    log.info("job_complete", {
      reinforced: eligible.length,
      total: job.memories.length,
      skipped_cooldown: coolingDown.size,
    });
  } catch (err) {
    // Batch failed — fall back to per-memory processing
    log.warn("batch_reinforce_failed_fallback", {
      error: err instanceof Error ? err.message : String(err),
    });

    let reinforced = 0;
    for (const mem of job.memories) {
      try {
        const ok = await reinforceMemory(
          mem.memory_id,
          mem.memory_type,
          job.tenant_id,
          job.workspace_id
        );
        if (ok) reinforced++;
      } catch (innerErr) {
        log.error("reinforce_failed", {
          memory_id: mem.memory_id,
          error: innerErr instanceof Error ? innerErr.message : String(innerErr),
        });
      }
    }
    log.info("job_complete_fallback", { reinforced, total: job.memories.length });
  }
}
