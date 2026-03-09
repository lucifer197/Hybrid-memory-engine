/**
 * Safe consolidation wrapper — adds timeouts and structured fallback
 * logging around the core consolidateMemory pipeline.
 *
 * Fallback rules:
 *   - If DB write times out during fact creation → transaction rolls back,
 *     job retries via the normal retry/DLQ pipeline
 *   - If fact extraction fails → memory is skipped (no facts), logged for
 *     investigation, but the worker stays healthy
 *   - The original write (memory-service → memories table) is never blocked
 *     by consolidation failures
 */

import { PoolClient } from "pg";
import {
  createLogger,
  withTimeout,
  TimeoutError,
} from "@hybrid-memory/observability";
import {
  consolidateMemory,
  type ConsolidateResult,
} from "../jobs/consolidate_recent";
import type { MemoryRow } from "../repositories/memoryRepo";
import { getEnv } from "../config/env";

const log = createLogger("consolidation-worker", "safeConsolidate");

/**
 * Execute consolidation for a single memory with a timeout guard.
 *
 * If the consolidation exceeds CONSOLIDATION_JOB_TIMEOUT_MS, the
 * transaction should be rolled back by the caller (withTransaction).
 * This wrapper provides structured logging so timeouts are observable.
 */
export async function safeConsolidateMemory(
  client: PoolClient,
  memory: MemoryRow
): Promise<ConsolidateResult> {
  const env = getEnv();

  try {
    return await withTimeout(
      consolidateMemory(client, memory),
      env.CONSOLIDATION_JOB_TIMEOUT_MS,
      "consolidation"
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      log.error("consolidation_timeout", {
        memory_id: memory.memory_id,
        tenant_id: memory.tenant_id,
        timeout_ms: env.CONSOLIDATION_JOB_TIMEOUT_MS,
      });
    } else {
      log.error("consolidation_failed", {
        memory_id: memory.memory_id,
        tenant_id: memory.tenant_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Re-throw so the retry/DLQ pipeline in main.ts handles it
    throw err;
  }
}
