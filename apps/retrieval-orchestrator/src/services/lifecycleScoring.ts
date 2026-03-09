import { MemoryType } from "@hybrid-memory/shared-types";
import type { RetrievalConfig } from "../config/retrievalConfig";

// ── Fallback defaults (used when no config is passed) ─────────
const DEFAULT_HALF_LIFE_EPISODIC = 72;   // 3 days
const DEFAULT_HALF_LIFE_SEMANTIC = 720;  // 30 days
const DEFAULT_ARCHIVED_PENALTY = 0.7;
const DEFAULT_W_VECTOR    = 0.55;
const DEFAULT_W_GRAPH     = 0.20;
const DEFAULT_W_RECENCY   = 0.15;
const DEFAULT_W_STABILITY = 0.07;
const DEFAULT_W_IMPORTANCE = 0.03;

/** Scoring-related subset of RetrievalConfig used by these functions. */
export interface ScoringWeights {
  vectorWeight: number;
  graphWeight: number;
  recencyWeight: number;
  stabilityWeight: number;
  importanceWeight: number;
  archivedPenalty: number;
  recencyHalfLifeEpisodicHours: number;
  recencyHalfLifeSemanticHours: number;
}

/**
 * Compute recency score (0..1) using exponential decay.
 *
 *   recency = exp(-age_hours / half_life)
 *
 * Pinned memories always return 1.0.
 */
export function computeRecencyScore(
  lastAccessedAt: Date | null,
  createdAt: Date,
  memoryType: MemoryType | string,
  pinned: boolean,
  config?: Pick<ScoringWeights, "recencyHalfLifeEpisodicHours" | "recencyHalfLifeSemanticHours">
): number {
  if (pinned) return 1.0;

  const referenceTime = lastAccessedAt ?? createdAt;
  const ageHours = Math.max(0, (Date.now() - referenceTime.getTime()) / 3_600_000);

  const halfLifeEpisodic = config?.recencyHalfLifeEpisodicHours ?? DEFAULT_HALF_LIFE_EPISODIC;
  const halfLifeSemantic = config?.recencyHalfLifeSemanticHours ?? DEFAULT_HALF_LIFE_SEMANTIC;

  const halfLife =
    memoryType === MemoryType.Semantic ? halfLifeSemantic : halfLifeEpisodic;

  return Math.exp(-ageHours / halfLife);
}

/**
 * Lifecycle-aware final fusion score.
 *
 * Uses configurable weights (default: 0.55 vector + 0.20 graph +
 * 0.15 recency + 0.07 stability + 0.03 importance).
 */
export function computeLifecycleFinalScore(
  vectorScore: number,
  graphScore: number,
  recencyScore: number,
  stabilityScore: number,
  importance: number,
  config?: Pick<ScoringWeights, "vectorWeight" | "graphWeight" | "recencyWeight" | "stabilityWeight" | "importanceWeight">
): number {
  const wV = config?.vectorWeight ?? DEFAULT_W_VECTOR;
  const wG = config?.graphWeight ?? DEFAULT_W_GRAPH;
  const wR = config?.recencyWeight ?? DEFAULT_W_RECENCY;
  const wS = config?.stabilityWeight ?? DEFAULT_W_STABILITY;
  const wI = config?.importanceWeight ?? DEFAULT_W_IMPORTANCE;

  return (
    wV * vectorScore +
    wG * graphScore +
    wR * recencyScore +
    wS * stabilityScore +
    wI * importance
  );
}

/**
 * Apply archived penalty: archived memories can still surface
 * if highly relevant, but their final score is reduced.
 */
export function applyArchivedPenalty(
  finalScore: number,
  status: string,
  config?: Pick<ScoringWeights, "archivedPenalty">
): number {
  const penalty = config?.archivedPenalty ?? DEFAULT_ARCHIVED_PENALTY;
  return status === "archived" ? finalScore * penalty : finalScore;
}
