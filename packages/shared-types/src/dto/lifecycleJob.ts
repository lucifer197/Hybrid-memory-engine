/**
 * Jobs enqueued by retrieval-orchestrator → consumed by lifecycle-worker.
 */

export interface AccessJob {
  type: "access";
  tenant_id: string;
  workspace_id: string;
  memory_ids: string[];
  trace_id?: string;
}

export interface ReinforceJob {
  type: "reinforce";
  tenant_id: string;
  workspace_id: string;
  /** Top-N memories to reinforce, with their type for delta selection. */
  memories: Array<{ memory_id: string; memory_type: string }>;
  trace_id?: string;
}

export type LifecycleJob = AccessJob | ReinforceJob;
