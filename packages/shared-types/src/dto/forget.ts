export interface ForgetRequest {
  tenant_id: string;
  workspace_id: string;
  /** Delete a specific memory by ID */
  memory_id?: string;
  /** Delete all memories for this user within the workspace */
  user_id?: string;
  /** Reason for deletion (stored in event metadata for compliance) */
  reason?: string;
}

export interface ForgetResponse {
  deleted_count: number;
  memory_ids: string[];
}
