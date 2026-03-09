/**
 * Stage 1 — Fast Candidate Retrieval
 *
 * The first stage of the three-stage retrieval pipeline.
 * Embeds the user query and performs a vector similarity search
 * to fetch a broad set of candidate memories.
 *
 * Only fast, simple signals are used here:
 *   - vector similarity
 *   - tenant / workspace / user scoping
 *   - session, memory_type, date filters
 *
 * No graph expansion, truth scoring, or lifecycle scoring.
 *
 * Target latency: < 80 ms
 */

import { embedQuery } from "../providers/embeddingProvider";
import { vectorSearch, type VectorHit } from "../repositories/vectorRepo";
import { type SanitizedQueryParams } from "./queryLimits";
import { vectorSimilarity as cosineDistanceToScore } from "./scoreSignals";
import { MemoryType } from "@hybrid-memory/shared-types";
import { createLogger } from "@hybrid-memory/observability";
import { vectorCandidatesCount } from "../observability/metrics";

const log = createLogger("retrieval-orchestrator", "stage1");

// ── Output type ─────────────────────────────────────────────────

export interface Stage1Candidate {
  memory_id: string;
  chunk_id: string;
  chunk_text: string;
  chunk_index: number;
  /** Cosine similarity 0..1 (converted from distance). */
  vector_score: number;
  /** Raw pgvector distance (for diagnostics). */
  raw_distance: number;
  memory_type: MemoryType;
  status: string;
  created_at: Date;
  metadata: Record<string, unknown>;
  /** Pass-through fields for later stages. */
  stability_score: number;
  importance: number;
  last_accessed_at: Date;
  pinned: boolean;
}

export interface Stage1Result {
  candidates: Stage1Candidate[];
  embedding: number[];
  /** All unique seed memory IDs (for graph expansion in Stage 2). */
  seedMemoryIds: string[];
  embed_ms: number;
  search_ms: number;
  total_ms: number;
}

// ── Input params ────────────────────────────────────────────────

export interface Stage1Params {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  query: string;
  queryParams: SanitizedQueryParams;
  filters?: {
    memory_types?: MemoryType[];
    session_id?: string;
    after?: string;
    before?: string;
  };
}

// ── Main function ───────────────────────────────────────────────

/**
 * Execute Stage 1: embed query + vector search.
 *
 * Returns raw candidates with vector scores, plus the embedding
 * and seed memory IDs for downstream stages.
 */
export async function stage1CandidateSearch(
  params: Stage1Params
): Promise<Stage1Result> {
  const start = performance.now();

  // ── 1. Embed the query ──────────────────────────────────────
  const embedStart = performance.now();
  const embedding = await embedQuery(params.query);
  const embed_ms = performance.now() - embedStart;

  // ── 2. Vector similarity search ─────────────────────────────
  const searchStart = performance.now();
  const rawHits: VectorHit[] = await vectorSearch({
    embedding,
    tenantId: params.tenant_id,
    workspaceId: params.workspace_id,
    userId: params.user_id,
    limit: params.queryParams.vectorLimit,
    memoryTypes: params.filters?.memory_types,
    sessionId: params.filters?.session_id,
    after: params.filters?.after,
    before: params.filters?.before,
  });
  const search_ms = performance.now() - searchStart;

  // ── 3. Convert to Stage1Candidates ──────────────────────────
  const candidates: Stage1Candidate[] = rawHits.map((hit) => ({
    memory_id: hit.memory_id,
    chunk_id: hit.chunk_id,
    chunk_text: hit.chunk_text,
    chunk_index: hit.chunk_index,
    vector_score: cosineDistanceToScore(hit.distance),
    raw_distance: hit.distance,
    memory_type: hit.memory_type,
    status: hit.status,
    created_at: hit.created_at,
    metadata: hit.metadata,
    stability_score: hit.stability_score,
    importance: hit.importance,
    last_accessed_at: hit.last_accessed_at,
    pinned: hit.pinned,
  }));

  // ── 4. Extract unique seed IDs for graph expansion ──────────
  const seedMemoryIds = [...new Set(rawHits.map((h) => h.memory_id))];

  const total_ms = performance.now() - start;

  // ── 5. Metrics + logging ────────────────────────────────────
  vectorCandidatesCount.observe(candidates.length);
  log.info("stage1_complete", {
    query_length: params.query.length,
    candidates: candidates.length,
    unique_memories: seedMemoryIds.length,
    embed_ms: Math.round(embed_ms),
    search_ms: Math.round(search_ms),
    total_ms: Math.round(total_ms),
    top_score: candidates.length > 0
      ? parseFloat(candidates[0].vector_score.toFixed(4))
      : 0,
  });

  return {
    candidates,
    embedding,
    seedMemoryIds,
    embed_ms,
    search_ms,
    total_ms,
  };
}
