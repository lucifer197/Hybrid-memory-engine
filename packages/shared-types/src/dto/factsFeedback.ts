// ── Fact feedback request/response types ─────────────────────

export interface ConfirmFactRequest {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
}

export interface ConfirmFactResponse {
  fact_id: string;
  trust_score: number;
  confidence: number;
  verification_count: number;
  truth_status: string;
}

export interface RejectFactRequest {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
  reason?: string;
}

export interface RejectFactResponse {
  fact_id: string;
  trust_score: number;
  confidence: number;
  rejection_count: number;
  truth_status: string;
}

export interface CorrectFactRequest {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
  new_value_text: string;
  new_value_json?: unknown;
}

export interface CorrectFactResponse {
  old_fact_id: string;
  new_fact_id: string;
  trust_score: number;
  confidence: number;
  truth_status: string;
}
