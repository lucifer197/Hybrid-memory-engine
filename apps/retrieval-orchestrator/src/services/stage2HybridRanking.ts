/**
 * Stage 2 — Hybrid Intelligence Ranking
 *
 * The second stage of the three-stage retrieval pipeline.
 * Takes Stage 1 candidates (~100) and applies the full hybrid
 * ranking model: graph expansion, recency, stability, truth,
 * importance, then the unified fusion formula.
 *
 * Returns the top N candidates (default 20) sorted by final_score.
 *
 * Target latency: < 150 ms
 */

import type { Stage1Candidate, Stage1Result } from "./stage1CandidateSearch";
import type { RetrievalConfig } from "../config/retrievalConfig";
import { graphExpand, type GraphCandidate } from "./graphExpand";
import { getMemoriesByIds, type MemoryRow } from "../repositories/memoryReadRepo";
import { clampGraphOptions, trimGraphCandidates } from "./candidateLimiter";
import { rankCandidate, type ScoreBreakdown } from "./fusionRanker";
import {
  memoryRecencyScore,
  importanceScore as computeImportance,
  truthScore as computeTruthScore,
} from "./scoreSignals";
import { GRAPH_ONLY_CONTENT_LIMIT } from "./queryLimits";
import { MemoryType } from "@hybrid-memory/shared-types";
import { createLogger, CircuitBreaker } from "@hybrid-memory/observability";
import {
  graphCandidatesCount,
  candidateCount,
  cbStateChange,
} from "../observability/metrics";
import { getEnv } from "../config/env";

const log = createLogger("retrieval-orchestrator", "stage2");

const graphBreaker = new CircuitBreaker({
  name: "graph_expand_s2",
  failureThreshold: getEnv().CB_GRAPH_FAILURE_THRESHOLD,
  resetTimeoutMs: getEnv().CB_GRAPH_RESET_MS,
  onStateChange: (name, from, to) => {
    cbStateChange.inc({ breaker: name, to });
    log.warn("circuit_breaker_transition", { breaker: name, from, to });
  },
});

// ── Output type ─────────────────────────────────────────────────

export interface Stage2Candidate {
  memory_id: string;
  chunk_id: string;
  chunk_text: string;
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

export interface Stage2Result {
  candidates: Stage2Candidate[];
  total_before_trim: number;
  graph_candidates_count: number;
  ranking_ms: number;
}

// ── Config ──────────────────────────────────────────────────────

/** Default number of candidates to keep after Stage 2 ranking. */
const DEFAULT_STAGE2_TOP_N = 20;

// ── Main function ───────────────────────────────────────────────

/**
 * Execute Stage 2: graph expansion + hybrid fusion ranking.
 *
 * Takes Stage 1 results, enriches with graph/recency/stability/truth,
 * runs the unified fusion ranker, and returns the top N candidates.
 */
export async function stage2HybridRanking(
  stage1: Stage1Result,
  cfg: RetrievalConfig,
  scope: { tenant_id: string; workspace_id: string; user_id: string },
  topN = DEFAULT_STAGE2_TOP_N
): Promise<Stage2Result> {
  const start = performance.now();

  // ── 1. Graph expansion from seed memory IDs ─────────────────
  const seedIds = stage1.seedMemoryIds.slice(0, 30); // max graph seeds
  let graphCandidates: GraphCandidate[] = [];

  const graphOpts = clampGraphOptions({
    maxNeighborsPerSeed: cfg.maxNeighborsPerSeed,
    maxGraphCandidates: cfg.maxGraphCandidates,
    maxHops: cfg.maxHops,
  });

  try {
    graphCandidates = await graphBreaker.execute(() =>
      graphExpand(scope.tenant_id, scope.workspace_id, seedIds, {
        maxNeighborsPerSeed: graphOpts.maxNeighborsPerSeed,
        maxTotalCandidates: graphOpts.maxGraphCandidates,
        maxHops: graphOpts.maxHops,
      })
    );
    graphCandidates = trimGraphCandidates(graphCandidates);
    graphCandidatesCount.observe(graphCandidates.length);
  } catch (err) {
    log.warn("graph_expand_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Index graph candidates by memory_id
  const graphMap = new Map<string, GraphCandidate>();
  for (const gc of graphCandidates) {
    graphMap.set(gc.memory_id, gc);
  }

  // ── 2. Score Stage 1 candidates (vector hits) ───────────────
  const ranked: Stage2Candidate[] = [];
  const seenMemoryIds = new Set<string>();

  for (const c of stage1.candidates) {
    const gc = graphMap.get(c.memory_id);
    const graphScore = gc?.graph_score ?? 0;
    const importance = computeImportance(c.importance ?? null, c.memory_type);
    const recencyScore = memoryRecencyScore(
      c.last_accessed_at,
      c.created_at,
      c.memory_type,
      c.pinned ?? false
    );
    const truth_score = computeTruthScore(null, null, 0, 0);
    const isArchived = c.status === "archived";

    const breakdown = rankCandidate({
      candidate_type: "memory",
      vector_score: c.vector_score,
      graph_score: graphScore,
      recency_score: recencyScore,
      stability_score: c.stability_score ?? 0,
      truth_score,
      importance_score: importance,
      is_archived: isArchived,
      truth_status: "active",
      confidence: 0.5,
      rejection_count: 0,
    });

    ranked.push({
      memory_id: c.memory_id,
      chunk_id: c.chunk_id,
      chunk_text: c.chunk_text,
      chunk_index: c.chunk_index,
      memory_type: c.memory_type,
      created_at: c.created_at,
      metadata: c.metadata,
      vector_score: c.vector_score,
      graph_score: graphScore,
      recency_score: recencyScore,
      stability_score: c.stability_score ?? 0,
      importance,
      truth_score,
      breakdown,
      final_score: breakdown.final_score,
      hop_depth: gc ? gc.hop_depth : 0,
      is_archived: isArchived,
      truth_status: "active",
      confidence: 0.5,
      rejection_count: 0,
    });

    seenMemoryIds.add(c.memory_id);
  }

  // ── 3. Score graph-only neighbors (not in vector hits) ──────
  const graphOnlyIds = graphCandidates
    .filter((gc) => !seenMemoryIds.has(gc.memory_id))
    .map((gc) => gc.memory_id);

  if (graphOnlyIds.length > 0) {
    try {
      const memoryRows = await getMemoriesByIds(
        scope.tenant_id,
        scope.workspace_id,
        scope.user_id,
        graphOnlyIds
      );
      const memoryMap = new Map<string, MemoryRow>();
      for (const row of memoryRows) {
        memoryMap.set(row.memory_id, row);
      }

      for (const gc of graphCandidates) {
        if (seenMemoryIds.has(gc.memory_id)) continue;
        const mem = memoryMap.get(gc.memory_id);
        if (!mem) continue;

        const importance = computeImportance(mem.importance ?? null, mem.memory_type);
        const isArchived = mem.status === "archived";
        const recencyScore = memoryRecencyScore(
          mem.last_accessed_at,
          mem.created_at,
          mem.memory_type,
          mem.pinned ?? false
        );
        const truth_score = computeTruthScore(null, null, 0, 0);

        const breakdown = rankCandidate({
          candidate_type: "memory",
          vector_score: 0,
          graph_score: gc.graph_score,
          recency_score: recencyScore,
          stability_score: mem.stability_score ?? 0,
          truth_score,
          importance_score: importance,
          is_archived: isArchived,
          truth_status: "active",
          confidence: 0.5,
          rejection_count: 0,
        });

        ranked.push({
          memory_id: gc.memory_id,
          chunk_id: "",
          chunk_text: mem.content_summary ?? mem.content_raw.slice(0, GRAPH_ONLY_CONTENT_LIMIT),
          chunk_index: 0,
          memory_type: mem.memory_type as MemoryType,
          created_at: mem.created_at,
          metadata: mem.metadata,
          vector_score: 0,
          graph_score: gc.graph_score,
          recency_score: recencyScore,
          stability_score: mem.stability_score ?? 0,
          importance,
          truth_score,
          breakdown,
          final_score: breakdown.final_score,
          hop_depth: gc.hop_depth,
          is_archived: isArchived,
          truth_status: "active",
          confidence: 0.5,
          rejection_count: 0,
        });

        seenMemoryIds.add(gc.memory_id);
      }
    } catch (err) {
      log.warn("graph_only_fetch_failed", {
        error: err instanceof Error ? err.message : String(err),
        skipped: graphOnlyIds.length,
      });
    }
  }

  // ── 4. Sort by final_score DESC, trim to topN ──────────────
  ranked.sort((a, b) => b.final_score - a.final_score);
  const totalBeforeTrim = ranked.length;
  const topCandidates = ranked.slice(0, topN);

  const ranking_ms = performance.now() - start;

  // ── 5. Metrics + logging ────────────────────────────────────
  candidateCount.observe(totalBeforeTrim);
  log.info("stage2_complete", {
    candidates_in: stage1.candidates.length,
    graph_only: graphOnlyIds.length,
    total_scored: totalBeforeTrim,
    returned: topCandidates.length,
    graph_candidates: graphCandidates.length,
    ranking_ms: Math.round(ranking_ms),
    top_score: topCandidates.length > 0
      ? parseFloat(topCandidates[0].final_score.toFixed(4))
      : 0,
  });

  return {
    candidates: topCandidates,
    total_before_trim: totalBeforeTrim,
    graph_candidates_count: graphCandidates.length,
    ranking_ms,
  };
}
