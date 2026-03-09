/**
 * Debug formatter for fusion ranking score breakdowns.
 *
 * Converts internal ScoreBreakdown into the DebugInfo DTO
 * returned to callers when `debug: true` is set.
 */

import type { DebugInfo } from "@hybrid-memory/shared-types";
import type { ScoreBreakdown } from "./fusionRanker";

export interface DebugCandidate {
  breakdown: ScoreBreakdown;
  hop_depth: number;
  is_archived: boolean;
  memory_id: string;
}

/**
 * Build a DebugInfo DTO from a scored candidate's breakdown.
 */
export function toRankingDebugInfo(
  candidate: DebugCandidate,
  retrievalMs: number
): DebugInfo {
  const b = candidate.breakdown;
  return {
    memory_id: candidate.memory_id,
    vector_score: b.vector_component,
    graph_score: b.graph_component,
    recency_score: b.recency_component,
    stability_score: b.stability_component,
    truth_score: b.truth_component,
    importance: b.importance_component,
    raw_score: b.raw_score,
    penalties_applied: b.penalties_applied,
    penalty_multiplier: b.penalty_multiplier,
    final_score: b.final_score,
    hop_depth: candidate.hop_depth,
    is_archived: candidate.is_archived,
    retrieval_ms: parseFloat(retrievalMs.toFixed(1)),
  };
}
