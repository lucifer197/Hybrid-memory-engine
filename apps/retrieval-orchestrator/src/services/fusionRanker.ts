/**
 * Unified fusion ranker — the single source of truth for final ordering.
 *
 * Produces a final_score from all available signals:
 *   vector, graph, recency, stability, truth, importance
 *
 * Applies penalties for:
 *   archived, contested, superseded, low-confidence, high-rejection, unknown
 *
 * Two weight profiles:
 *   - memoryWeights  (0.45 vector, 0.20 graph, 0.10 recency, 0.10 stability, 0.10 truth, 0.05 importance)
 *   - factWeights    (0.35 vector, 0.15 graph, 0.10 recency, 0.15 stability, 0.20 truth, 0.05 importance)
 */

import {
  getRankingConfig,
  LOW_CONFIDENCE_THRESHOLD,
  HIGH_REJECTION_THRESHOLD,
  type MemoryWeights,
  type FactWeights,
  type Penalties,
} from "../config/rankingConfig";

// ── Input types ─────────────────────────────────────────────────

export interface RankableCandidate {
  candidate_type: "memory" | "fact";

  // Pre-computed signal scores (all 0..1)
  vector_score: number;
  graph_score: number;
  recency_score: number;
  stability_score: number;
  truth_score: number;
  importance_score: number;

  // Status flags for penalty application
  is_archived: boolean;
  truth_status: string;     // "active" | "contested" | "superseded" | "unknown"
  confidence: number;       // for low-confidence penalty
  rejection_count: number;  // for high-rejection penalty
}

export interface ScoreBreakdown {
  vector_component: number;
  graph_component: number;
  recency_component: number;
  stability_component: number;
  truth_component: number;
  importance_component: number;
  raw_score: number;
  penalties_applied: string[];
  penalty_multiplier: number;
  final_score: number;
}

// ── Main ranking function ───────────────────────────────────────

/**
 * Compute the final ranked score for a candidate.
 *
 * Returns both the final_score and a full breakdown for debugging.
 */
export function rankCandidate(input: RankableCandidate): ScoreBreakdown {
  const config = getRankingConfig();
  const weights = input.candidate_type === "fact"
    ? config.factWeights
    : config.memoryWeights;
  const penalties = config.penalties;

  // ── Weighted sum ────────────────────────────────────────────
  const vector_component = weights.vector * input.vector_score;
  const graph_component = weights.graph * input.graph_score;
  const recency_component = weights.recency * input.recency_score;
  const stability_component = weights.stability * input.stability_score;
  const truth_component = weights.truth * input.truth_score;
  const importance_component = weights.importance * input.importance_score;

  const raw_score =
    vector_component +
    graph_component +
    recency_component +
    stability_component +
    truth_component +
    importance_component;

  // ── Penalties ───────────────────────────────────────────────
  let multiplier = 1.0;
  const applied: string[] = [];

  if (input.is_archived) {
    multiplier *= penalties.archived;
    applied.push("archived");
  }

  if (input.truth_status === "contested") {
    multiplier *= penalties.contested;
    applied.push("contested");
  } else if (input.truth_status === "superseded") {
    multiplier *= penalties.superseded;
    applied.push("superseded");
  } else if (input.truth_status === "unknown") {
    multiplier *= penalties.unknown;
    applied.push("unknown");
  }

  if (input.confidence < LOW_CONFIDENCE_THRESHOLD) {
    multiplier *= penalties.lowConfidence;
    applied.push("low_confidence");
  }

  if (input.rejection_count >= HIGH_REJECTION_THRESHOLD) {
    multiplier *= penalties.highRejection;
    applied.push("high_rejection");
  }

  const final_score = clamp(raw_score * multiplier);

  return {
    vector_component: round4(vector_component),
    graph_component: round4(graph_component),
    recency_component: round4(recency_component),
    stability_component: round4(stability_component),
    truth_component: round4(truth_component),
    importance_component: round4(importance_component),
    raw_score: round4(raw_score),
    penalties_applied: applied,
    penalty_multiplier: round4(multiplier),
    final_score: round4(final_score),
  };
}

// ── Batch ranking ───────────────────────────────────────────────

/**
 * Rank a list of candidates and return them sorted by final_score DESC.
 */
export function rankAll<T extends RankableCandidate>(
  candidates: T[]
): (T & { breakdown: ScoreBreakdown })[] {
  return candidates
    .map((c) => ({ ...c, breakdown: rankCandidate(c) }))
    .sort((a, b) => b.breakdown.final_score - a.breakdown.final_score);
}

// ── Helpers ─────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round4(v: number): number {
  return parseFloat(v.toFixed(4));
}
