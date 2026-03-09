export interface GraphJob {
  tenant_id: string;
  workspace_id: string;
  memory_id: string;
  session_id?: string;
  user_id: string;
  tags?: string[];
  trace_id?: string;
}
