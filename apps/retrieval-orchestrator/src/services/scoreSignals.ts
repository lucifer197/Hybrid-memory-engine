/**
 * Individual signal score computations.
 *
 * Each function produces a normalized 0..1 value from raw inputs.
 * These are then combined by fusionRanker using weighted sums.
 */

import {
  DEFAULT_TRUTH_SUB_WEIGHTS,
  DEFAULT_RECENCY_HALF_LIVES,
  type TruthSubWeights,
  type RecencyHalfLives,
} from "../config/rankingConfig";

// ── Vector score ────────────────────────────────────────────────

/**
 * Convert pgvector cosine distance (range [0, 2]) to similarity (0..1).
 */
export function vectorSimilarity(distance: number): number {
  return Math.max(0, Math.min(1, 1 - distance / 2));
}

// ── Recency score ───────────────────────────────────────────────

/**
 * Exponential decay recency score for memories.
 *
 *   score = exp(-age_hours / half_life_hours)
 *
 * Pinned memories always return 1.0.
 */
export function memoryRecencyScore(
  lastAccessedAt: Date | null,
  createdAt: Date,
  memoryType: string,
  pinned: boolean,
  halfLives?: Pick<RecencyHalfLives, "episodicHours" | "semanticHours">
): number {
  if (pinned) return 1.0;

  const ref = lastAccessedAt ?? createdAt;
  const ageHours = Math.max(0, (Date.now() - ref.getTime()) / 3_600_000);

  const hl = memoryType === "semantic"
    ? (halfLives?.semanticHours ?? DEFAULT_RECENCY_HALF_LIVES.semanticHours)
    : (halfLives?.episodicHours ?? DEFAULT_RECENCY_HALF_LIVES.episodicHours);

  return Math.exp(-ageHours / hl);
}

/**
 * Exponential decay recency score for facts, based on last verification.
 *
 *   score = exp(-age_days * 0.1)
 *
 * Unverified facts get a moderate default (0.3).
 */
export function factRecencyScore(
  lastVerifiedAt: Date | null,
  halfLifeDays?: number
): number {
  if (!lastVerifiedAt) return 0.3;

  const ageDays = Math.max(0, (Date.now() - lastVerifiedAt.getTime()) / 86_400_000);
  const hl = halfLifeDays ?? DEFAULT_RECENCY_HALF_LIVES.factDays;
  return Math.exp(-ageDays / hl);
}

// ── Verification score ──────────────────────────────────────────

/**
 * Net verification score: clamp((verifications - rejections) / 5, 0, 1).
 *
 * A fact with 5 more verifications than rejections gets a perfect 1.0.
 */
export function verificationScore(
  verificationCount: number,
  rejectionCount: number
): number {
  return Math.max(0, Math.min(1, (verificationCount - rejectionCount) / 5));
}

// ── Truth score (composite) ─────────────────────────────────────

/**
 * Composite truth score combining trust, confidence, and verification.
 *
 *   truth = 0.50 × trust_score + 0.30 × confidence + 0.20 × verification_score
 *
 * For memories without truth metadata, returns a neutral default (0.5).
 */
export function truthScore(
  trustScore: number | null,
  confidence: number | null,
  verificationCount: number,
  rejectionCount: number,
  subWeights?: TruthSubWeights
): number {
  const w = subWeights ?? DEFAULT_TRUTH_SUB_WEIGHTS;

  const trust = trustScore ?? 0.5;    // neutral default for memories
  const conf = confidence ?? 0.5;     // neutral default for memories
  const vScore = verificationScore(verificationCount, rejectionCount);

  return Math.max(0, Math.min(1,
    w.trust * trust +
    w.confidence * conf +
    w.verification * vScore
  ));
}

// ── Importance score ────────────────────────────────────────────

/**
 * Normalize importance to 0..1 (pass-through clamp).
 *
 * For items without explicit importance, infer from type:
 *   - preference/profile facts → 0.8
 *   - project facts → 0.7
 *   - semantic memory → 0.6
 *   - episodic memory → 0.4
 */
export function importanceScore(
  explicitImportance: number | null,
  itemType?: string
): number {
  if (explicitImportance != null && explicitImportance > 0) {
    return Math.max(0, Math.min(1, explicitImportance));
  }

  switch (itemType) {
    case "preference":
    case "profile":
      return 0.8;
    case "project":
      return 0.7;
    case "semantic":
      return 0.6;
    case "episodic":
    default:
      return 0.4;
  }
}
