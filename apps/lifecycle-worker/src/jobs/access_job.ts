import type { AccessJob } from "@hybrid-memory/shared-types";
import { memoryRepo } from "../repositories/memoryRepo";
import { eventRepo } from "../repositories/eventRepo";
import { getPool } from "../db";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("lifecycle-worker", "access");

/**
 * Process an access event: update last_accessed_at and log access events.
 * Called from the queue consumer when retrieval results are returned.
 */
export async function processAccessJob(job: AccessJob): Promise<void> {
  const { tenant_id, workspace_id, memory_ids } = job;
  if (memory_ids.length === 0) return;

  // 1. Touch last_accessed_at (fire-and-forget, no transaction needed)
  const touched = await memoryRepo.touchAccessed(memory_ids);

  // 2. Batch-insert access events
  const pool = getPool();
  const values: unknown[] = [];
  const placeholders: string[] = [];
  for (let i = 0; i < memory_ids.length; i++) {
    const offset = i * 3;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, 'accessed')`
    );
    values.push(tenant_id, workspace_id, memory_ids[i]);
  }

  await pool.query(
    `INSERT INTO memory_events (tenant_id, workspace_id, memory_id, event_type)
     VALUES ${placeholders.join(", ")}`,
    values
  );

  log.info("access_logged", { count: memory_ids.length, touched });
}
