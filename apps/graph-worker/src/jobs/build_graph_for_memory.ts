import type { GraphJob } from "@hybrid-memory/shared-types";
import { withTransaction } from "../db";
import { memoryReadRepo } from "../repositories/memoryReadRepo";
import { buildEdgesForMemory, type BuildEdgesResult } from "../services/edgeBuilder";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("graph-worker", "buildGraph");

/**
 * Job handler: load the memory row and run all edge-building rules
 * inside a single transaction.
 */
export async function buildGraphForMemory(job: GraphJob): Promise<void> {
  const start = Date.now();

  log.info("job_received", {
    memory_id: job.memory_id,
    tenant_id: job.tenant_id,
    workspace_id: job.workspace_id,
  });

  const memory = await memoryReadRepo.getById(job.memory_id);

  if (!memory) {
    log.warn("memory_not_found", { memory_id: job.memory_id });
    return;
  }

  const result: BuildEdgesResult = await withTransaction((client) =>
    buildEdgesForMemory(client, memory)
  );

  const elapsed = Date.now() - start;

  log.info("job_completed", {
    memory_id: job.memory_id,
    same_session: result.same_session,
    follows: result.follows,
    similar_to: result.similar_to,
    shares_entity: result.shares_entity,
    entities_extracted: result.entities_extracted,
    elapsed_ms: elapsed,
  });
}
