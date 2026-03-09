/**
 * Centralized ranking configuration.
 *
 * All weights, penalties, and decay parameters live here.
 * Per-tenant overrides flow through RetrievalConfig → these defaults.
 */

// ── Memory weights (must sum to 1.0) ────────────────────────────

export interface MemoryWeights {
  vector: number;
  graph: number;
  recency: number;
  stability: number;
  truth: number;
  importance: number;
}

export const DEFAULT_MEMORY_WEIGHTS: MemoryWeights = {
  vector: 0.45,
  graph: 0.20,
  recency: 0.10,
  stability: 0.10,
  truth: 0.10,
  importance: 0.05,
};

// ── Fact weights (must sum to 1.0) ──────────────────────────────

export interface FactWeights {
  vector: number;
  graph: number;
  recency: number;
  stability: number;
  truth: number;
  importance: number;
}

export const DEFAULT_FACT_WEIGHTS: FactWeights = {
  vector: 0.35,
  graph: 0.15,
  recency: 0.10,
  stability: 0.15,
  truth: 0.20,
  importance: 0.05,
};

// ── Truth score sub-weights ─────────────────────────────────────

export interface TruthSubWeights {
  trust: number;
  confidence: number;
  verification: number;
}

export const DEFAULT_TRUTH_SUB_WEIGHTS: TruthSubWeights = {
  trust: 0.50,
  confidence: 0.30,
  verification: 0.20,
};

// ── Penalties ───────────────────────────────────────────────────

export interface Penalties {
  archived: number;
  contested: number;
  superseded: number;
  lowConfidence: number;
  highRejection: number;
  unknown: number;
}

export const DEFAULT_PENALTIES: Penalties = {
  archived: 0.75,
  contested: 0.70,
  superseded: 0.25,
  lowConfidence: 0.85,
  highRejection: 0.85,
  unknown: 0.60,
};

/** Confidence threshold below which lowConfidence penalty applies. */
export const LOW_CONFIDENCE_THRESHOLD = 0.35;

/** Rejection count at or above which highRejection penalty applies. */
export const HIGH_REJECTION_THRESHOLD = 3;

// ── Recency half-lives (hours) ──────────────────────────────────

export interface RecencyHalfLives {
  episodicHours: number;
  semanticHours: number;
  factDays: number;
}

export const DEFAULT_RECENCY_HALF_LIVES: RecencyHalfLives = {
  episodicHours: 72,    // 3 days
  semanticHours: 720,   // 30 days
  factDays: 7,          // 1 week for fact verification recency
};

// ── Graph hop penalties ─────────────────────────────────────────

export const GRAPH_HOP_PENALTIES: number[] = [
  1.0,  // hop 0 (direct vector hit, not really a hop)
  1.0,  // hop 1
  0.5,  // hop 2
];

// ── Full config bundle ──────────────────────────────────────────

export interface RankingConfig {
  memoryWeights: MemoryWeights;
  factWeights: FactWeights;
  truthSubWeights: TruthSubWeights;
  penalties: Penalties;
  recencyHalfLives: RecencyHalfLives;
}

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  memoryWeights: DEFAULT_MEMORY_WEIGHTS,
  factWeights: DEFAULT_FACT_WEIGHTS,
  truthSubWeights: DEFAULT_TRUTH_SUB_WEIGHTS,
  penalties: DEFAULT_PENALTIES,
  recencyHalfLives: DEFAULT_RECENCY_HALF_LIVES,
};

let _config: RankingConfig | null = null;

/** Get the current ranking config (cached singleton). */
export function getRankingConfig(): RankingConfig {
  if (!_config) {
    _config = { ...DEFAULT_RANKING_CONFIG };
  }
  return _config;
}
