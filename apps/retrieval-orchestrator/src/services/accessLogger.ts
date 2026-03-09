import type { LifecycleJob } from "@hybrid-memory/shared-types";
import { enqueueLifecycleJob } from "../queue/lifecycleProducer";
import { getTraceId } from "@hybrid-memory/observability";

/**
 * Fire-and-forget lifecycle event producer.
 *
 * After each retrieval, enqueues:
 *   1. An access job (all returned memory IDs)
 *   2. A reinforce job (top N memories that should be strengthened)
 *
 * Both are sent to the lifecycle:jobs Redis queue and processed
 * asynchronously by the lifecycle-worker.
 */
export function logAccess(
  memories: Array<{ memory_id: string; memory_type: string }>,
  tenantId: string,
  workspaceId: string,
  reinforceTopN = 3
): void {
  if (memories.length === 0) return;

  const memoryIds = [...new Set(memories.map((m) => m.memory_id))];

  // 1. Enqueue access event for all returned memories
  const accessJob: LifecycleJob = {
    type: "access",
    tenant_id: tenantId,
    workspace_id: workspaceId,
    memory_ids: memoryIds,
    trace_id: getTraceId(),
  };
  enqueueLifecycleJob(accessJob);

  // 2. Enqueue reinforcement for top N (already sorted by final_score)
  const topMemories = memories.slice(0, reinforceTopN);
  if (topMemories.length > 0) {
    const reinforceJob: LifecycleJob = {
      type: "reinforce",
      tenant_id: tenantId,
      workspace_id: workspaceId,
      memories: topMemories,
      trace_id: getTraceId(),
    };
    enqueueLifecycleJob(reinforceJob);
  }
}
