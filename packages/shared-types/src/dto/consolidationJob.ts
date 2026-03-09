export interface ConsolidationJob {
  tenant_id: string;
  workspace_id: string;
  memory_id: string;
  user_id: string;
  memory_type: string;
  trace_id?: string;
}
