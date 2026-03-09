import { MemoryType } from "../enums/memoryType";
import { PrivacyScope } from "../enums/privacyScope";

// ── Sub-types ────────────────────────────────────────────────

export interface RetrieveFilters {
  memory_types?: MemoryType[];
  privacy_scope?: PrivacyScope;
  session_id?: string;
  agent_id?: string;
  after?: string;   // ISO-8601
  before?: string;  // ISO-8601
}

export interface MemoryRefDTO {
  memory_id: string;
  content: string;
  memory_type: MemoryType;
  /** Combined hybrid score (0-1) */
  score: number;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface DebugInfo {
  memory_id?: string;
  vector_score?: number;
  graph_score?: number;
  recency_score?: number;
  stability_score?: number;
  truth_score?: number;
  importance?: number;
  raw_score?: number;
  penalties_applied?: string[];
  penalty_multiplier?: number;
  final_score?: number;
  hop_depth?: number;
  is_archived?: boolean;
  retrieval_ms?: number;
}

// ── Request ──────────────────────────────────────────────────

export interface RetrieveContextRequest {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  query: string;

  // ── Optional ──
  session_id?: string;
  /** Number of memories to return (default 8, max 20) */
  k?: number;
  filters?: RetrieveFilters;
  /** Return scoring breakdown per memory */
  debug?: boolean;
}

// ── Fact reference (knowledge layer) ────────────────────────

export interface FactRefDTO {
  fact_id: string;
  fact_type: string;
  subject: string;
  predicate: string;
  value_text: string;
  value_json?: unknown;
  confidence: number;
  status: string;
  /** Trust score combining source trust + verification history */
  trust_score?: number;
  /** Number of times this fact has been confirmed */
  verification_count?: number;
  /** Number of times this fact has been rejected */
  rejection_count?: number;
  /** Boosted retrieval score (fact_score) */
  score: number;
  /** Top 3 evidence memory IDs that support this fact */
  evidence_memory_ids: string[];
}

// ── Pipeline debug (per-stage latencies) ────────────────────

export interface PipelineDebug {
  stage1_ms: number;
  stage2_ms: number;
  stage3_ms: number;
  total_ms: number;
  stage1_candidates: number;
  stage2_candidates: number;
  context_items: number;
}

// ── Response ─────────────────────────────────────────────────

export interface RetrieveContextResponse {
  /** Prompt-ready text blocks for direct LLM injection (facts first, then evidence) */
  context_blocks: string[];
  /** Stable knowledge facts matching the query (ranked first) */
  facts?: FactRefDTO[];
  memories: MemoryRefDTO[];
  debug_info?: DebugInfo[];
  /** Per-stage pipeline latencies and candidate counts (when debug=true) */
  pipeline_debug?: PipelineDebug;
}
