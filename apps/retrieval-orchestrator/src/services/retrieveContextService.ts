/**
 * Retrieval orchestrator — three-stage pipeline.
 *
 * Stage 1: Fast candidate retrieval (embed + vector search)
 * Stage 2: Hybrid intelligence ranking (graph + fusion ranker)
 * Stage 3: Context selection (dedup + prioritize + compose)
 *
 * This file is the top-level entry point. Each stage lives in its own module.
 */

import {
  type RetrieveContextRequest,
  type RetrieveContextResponse,
  MemoryType,
} from "@hybrid-memory/shared-types";
import { getRetrievalConfigForTenant } from "../config/retrievalConfig";
import { createLogger, withTimeout } from "@hybrid-memory/observability";
import {
  retrievalRequests,
  retrievalLatency,
  factsReturnedCount,
  scoreDist,
  retrievalEmptyResults,
  stage1Latency,
  stage2Latency,
  stage3Latency,
  stage1CandidateCount,
  stage2CandidateCount,
  contextSizeCount,
} from "../observability/metrics";
import { getEnv } from "../config/env";
import {
  buildRetrievalCacheKey,
  getCachedRetrieval,
  setCachedRetrieval,
} from "../cache/retrievalCache";
import { sanitizeQueryParams } from "./queryLimits";
import { stage1CandidateSearch } from "./stage1CandidateSearch";
import { stage2HybridRanking } from "./stage2HybridRanking";
import { stage3ContextSelector } from "./stage3ContextSelector";
import { assembleFacts } from "./factsAssembler";
import type { ScoreBreakdown } from "./fusionRanker";

const log = createLogger("retrieval-orchestrator", "retrieve");

// ── Public types (preserved for backward compat) ────────────────

export interface RetrieveResult extends RetrieveContextResponse {
  trace_id: string;
  retrieval_ms: number;
}

/** @deprecated Use Stage2Candidate from stage2HybridRanking instead. */
export interface FusionCandidate {
  memory_id: string;
  chunk_text: string;
  chunk_id: string;
  chunk_index: number;
  memory_type: MemoryType;
  created_at: Date;
  metadata: Record<string, unknown>;
  vector_score: number;
  graph_score: number;
  recency_score: number;
  stability_score: number;
  importance: number;
  truth_score: number;
  breakdown: ScoreBreakdown;
  final_score: number;
  hop_depth: number;
  is_archived: boolean;
  truth_status: string;
  confidence: number;
  rejection_count: number;
}

/**
 * Convert pgvector cosine distance (range [0, 2]) to a similarity score
 * clamped to [0, 1].
 */
export function cosineDistanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Three-stage retrieval pipeline.
 *
 * 1. Stage 1 — embed query + vector search (~100 candidates, <80ms)
 * 2. Stage 2 — graph expansion + fusion ranking (top 20, <150ms)
 * 3. Fact lookup — keyword + evidence overlap (parallel with stage 2 output)
 * 4. Stage 3 — context selection (top k items, <30ms)
 */
export async function retrieveContext(
  req: RetrieveContextRequest,
  traceId: string
): Promise<RetrieveResult> {
  const start = performance.now();
  retrievalRequests.inc();

  // ── 0a. Check retrieval cache (skip for debug requests) ──
  if (!req.debug) {
    const cacheKey = buildRetrievalCacheKey({
      tenant_id: req.tenant_id,
      workspace_id: req.workspace_id,
      user_id: req.user_id,
      query: req.query,
      filters: req.filters,
      k: req.k,
    });
    const cached = getCachedRetrieval(cacheKey);
    if (cached) {
      log.info("retrieval_cache_hit", { trace_id: traceId });
      return { ...cached, trace_id: traceId, retrieval_ms: 0 };
    }
  }

  // ── 0b. Load per-tenant config ───────────────────────────
  const cfg = await getRetrievalConfigForTenant(req.tenant_id, req.workspace_id);
  const qp = sanitizeQueryParams(req, cfg.maxCandidates);
  const k = qp.k;
  const env = getEnv();

  // ── STAGE 1 — Fast candidate retrieval ───────────────────
  const s1 = await stage1CandidateSearch({
    tenant_id: req.tenant_id,
    workspace_id: req.workspace_id,
    user_id: req.user_id,
    query: req.query,
    queryParams: qp,
    filters: {
      memory_types: req.filters?.memory_types,
      session_id: req.filters?.session_id ?? req.session_id,
      after: req.filters?.after,
      before: req.filters?.before,
    },
  });

  // ── STAGE 2 — Hybrid intelligence ranking ────────────────
  const stage2TopN = Math.max(k, 20); // rank at least 20 for good diversity
  const s2 = await stage2HybridRanking(
    s1,
    cfg,
    {
      tenant_id: req.tenant_id,
      workspace_id: req.workspace_id,
      user_id: req.user_id,
    },
    stage2TopN
  );

  // ── Fact lookup (knowledge layer) ────────────────────────
  const candidateMemoryIds = [...new Set(s2.candidates.map((c) => c.memory_id))];
  const topFusionScore = s2.candidates.length > 0 ? s2.candidates[0].final_score : 0;

  let factsResult: Awaited<ReturnType<typeof assembleFacts>> | null = null;
  try {
    factsResult = await withTimeout(
      assembleFacts(
        req.tenant_id,
        req.workspace_id,
        req.user_id,
        req.query,
        candidateMemoryIds,
        topFusionScore
      ),
      env.FACT_LOOKUP_TIMEOUT_MS,
      "fact_lookup"
    );
  } catch (err) {
    log.warn("fact_lookup_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── STAGE 3 — Context selection ──────────────────────────
  const retrievalMs = performance.now() - start;

  const s3 = stage3ContextSelector(
    s2.candidates,
    factsResult?.facts ?? [],
    factsResult?.factBlocks ?? [],
    retrievalMs,
    req.debug ?? false,
    {
      maxContextItems: k,
      maxFacts: Math.min(3, k),
      maxMemories: Math.max(2, k - 3),
      maxChunksPerMemory: cfg.maxChunksPerMemory,
    }
  );

  // ── Metrics ──────────────────────────────────────────────
  const totalMs = performance.now() - start;
  retrievalLatency.observe(totalMs);
  stage1Latency.observe(s1.total_ms);
  stage2Latency.observe(s2.ranking_ms);
  stage3Latency.observe(s3.selection_ms);
  stage1CandidateCount.observe(s1.candidates.length);
  stage2CandidateCount.observe(s2.candidates.length);
  contextSizeCount.observe(s3.items_selected);
  factsReturnedCount.observe(s3.facts.length);
  if (s3.memories.length === 0 && s3.facts.length === 0) retrievalEmptyResults.inc();
  for (const m of s3.memories) {
    scoreDist.observe(m.score);
  }

  // ── Build response ───────────────────────────────────────
  const result: RetrieveResult = {
    context_blocks: s3.context_blocks,
    memories: s3.memories,
    trace_id: traceId,
    retrieval_ms: totalMs,
  };

  if (s3.facts.length > 0) {
    result.facts = s3.facts;
  }

  if (req.debug) {
    result.debug_info = s3.debug_info;
    result.pipeline_debug = {
      stage1_ms: Math.round(s1.total_ms),
      stage2_ms: Math.round(s2.ranking_ms),
      stage3_ms: Math.round(s3.selection_ms),
      total_ms: Math.round(totalMs),
      stage1_candidates: s1.candidates.length,
      stage2_candidates: s2.candidates.length,
      context_items: s3.items_selected,
    };
  }

  // ── Cache result (skip for debug requests) ───────────────
  if (!req.debug) {
    const cacheKey = buildRetrievalCacheKey({
      tenant_id: req.tenant_id,
      workspace_id: req.workspace_id,
      user_id: req.user_id,
      query: req.query,
      filters: req.filters,
      k: req.k,
    });
    setCachedRetrieval(cacheKey, result);
  }

  log.info("retrieve_complete", {
    trace_id: traceId,
    stage1_ms: Math.round(s1.total_ms),
    stage2_ms: Math.round(s2.ranking_ms),
    stage3_ms: Math.round(s3.selection_ms),
    total_ms: Math.round(totalMs),
    k,
    stage1_candidates: s1.candidates.length,
    stage2_candidates: s2.candidates.length,
    memories_returned: s3.memories.length,
    facts_returned: s3.facts.length,
  });

  return result;
}
