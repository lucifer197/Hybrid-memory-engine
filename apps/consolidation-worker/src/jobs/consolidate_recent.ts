import { PoolClient } from "pg";
import { createLogger } from "@hybrid-memory/observability";
import { memoryRepo, MemoryRow } from "../repositories/memoryRepo";
import { extractFacts } from "../services/factExtractor";
import { reviseFact, RevisionResult } from "../services/beliefRevision";
import type { ConflictContext } from "../services/conflictDetector";

const log = createLogger("consolidation-worker", "consolidate_recent");

export interface ConsolidateResult {
  memoryId: string;
  factsExtracted: number;
  results: RevisionResult[];
}

/**
 * Consolidate a single memory: extract facts, run belief revision for each.
 */
export async function consolidateMemory(
  client: PoolClient,
  memory: MemoryRow
): Promise<ConsolidateResult> {
  const content = memory.content_summary ?? memory.content_raw;

  // 1. Extract candidate facts from the memory
  const tags = Array.isArray(memory.tags) ? memory.tags : [];
  const entities: string[] = Array.isArray((memory.metadata as Record<string, unknown>)?.entities)
    ? ((memory.metadata as Record<string, unknown>).entities as string[])
    : [];
  const hints: string[] = Array.isArray((memory.metadata as Record<string, unknown>)?.hints)
    ? ((memory.metadata as Record<string, unknown>).hints as string[])
    : [];
  const candidates = extractFacts(content, memory.memory_type, tags, entities, hints);

  if (candidates.length === 0) {
    log.debug("no_facts_extracted", { memory_id: memory.memory_id });
    return { memoryId: memory.memory_id, factsExtracted: 0, results: [] };
  }

  // 2. Build conflict context for belief revision rules (recency, explicit override)
  const conflictCtx: ConflictContext = {
    sourceContent: memory.content_raw,
    sourceCreatedAt: memory.created_at,
  };

  // 3. Run belief revision for each candidate
  const results: RevisionResult[] = [];
  for (const candidate of candidates) {
    const result = await reviseFact(
      client,
      candidate,
      memory.memory_id,
      memory.tenant_id,
      memory.workspace_id,
      memory.user_id,
      conflictCtx
    );
    results.push(result);
  }

  log.info("memory_consolidated", {
    memory_id: memory.memory_id,
    facts_extracted: candidates.length,
    created: results.filter((r) => r.action === "created").length,
    reinforced: results.filter((r) => r.action === "reinforced").length,
    superseded: results.filter((r) => r.action === "superseded").length,
    contested: results.filter((r) => r.action === "contested").length,
    skipped: results.filter((r) => r.action === "skipped").length,
  });

  return {
    memoryId: memory.memory_id,
    factsExtracted: candidates.length,
    results,
  };
}

/**
 * Scheduled sweep: find unconsolidated memories across all workspaces
 * and process them in batches.
 */
export async function sweepUnconsolidated(
  runInTransaction: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>,
  batchSize: number
): Promise<number> {
  // Find workspaces with pending work
  const workspaces = await memoryRepo.findWorkspacesWithPending(50);

  let totalProcessed = 0;

  for (const ws of workspaces) {
    const memories = await memoryRepo.findUnconsolidated(
      ws.tenant_id,
      ws.workspace_id,
      batchSize
    );

    for (const memory of memories) {
      try {
        await runInTransaction(async (client) => {
          await consolidateMemory(client, memory);
        });
        totalProcessed++;
      } catch (err) {
        log.error("sweep_memory_failed", {
          memory_id: memory.memory_id,
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue with next memory — don't let one failure stop the sweep
      }
    }
  }

  if (totalProcessed > 0) {
    log.info("sweep_complete", { total_processed: totalProcessed });
  }

  return totalProcessed;
}
