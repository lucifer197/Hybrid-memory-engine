/**
 * Truth-aware fact ranking for retrieval.
 *
 * Computes a composite fact_final score from:
 *   0.45 × relevance
 *   0.20 × confidence
 *   0.15 × trust_score
 *   0.10 × verification_score
 *   0.10 × recency_score
 *
 * Then applies truth_status penalties.
 */

export interface TruthRankInput {
  /** Semantic relevance from keyword/evidence overlap (0..1) */
  relevance: number;
  /** Consolidation confidence (0..1) */
  confidence: number;
  /** Source-based trust score (0..1) */
  trust_score: number;
  /** verification_count from the fact */
  verification_count: number;
  /** rejection_count from the fact */
  rejection_count: number;
  /** truth_status of the fact */
  truth_status: string;
  /** last_verified_at or last_confirmed_at timestamp */
  last_verified_at: Date | null;
}

// ── Weights ──────────────────────────────────────────────────

const W_RELEVANCE = 0.45;
const W_CONFIDENCE = 0.20;
const W_TRUST = 0.15;
const W_VERIFICATION = 0.10;
const W_RECENCY = 0.10;

// ── Penalties ────────────────────────────────────────────────

const CONTESTED_MULTIPLIER = 0.70;
const SUPERSEDED_MULTIPLIER = 0.30;
const HIGH_REJECTION_THRESHOLD = 3;
const HIGH_REJECTION_PENALTY = 0.85;

/**
 * verification_score = clamp((verifications - rejections) / 5, 0, 1)
 */
function verificationScore(verifications: number, rejections: number): number {
  return Math.max(0, Math.min(1, (verifications - rejections) / 5));
}

/**
 * Recency score based on last verification timestamp.
 * Exponential decay: 1.0 at t=0, ~0.5 at 7 days, ~0.25 at 14 days.
 */
function recencyScore(lastVerifiedAt: Date | null): number {
  if (!lastVerifiedAt) return 0.3; // unverified → moderate default
  const ageMs = Date.now() - lastVerifiedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return Math.exp(-0.1 * ageDays);
}

/**
 * Compute the truth-aware ranking score for a fact.
 */
export function truthRank(input: TruthRankInput): number {
  const vScore = verificationScore(input.verification_count, input.rejection_count);
  const rScore = recencyScore(input.last_verified_at);

  let score =
    W_RELEVANCE * input.relevance +
    W_CONFIDENCE * input.confidence +
    W_TRUST * input.trust_score +
    W_VERIFICATION * vScore +
    W_RECENCY * rScore;

  // Truth status penalties
  if (input.truth_status === "contested") {
    score *= CONTESTED_MULTIPLIER;
  } else if (input.truth_status === "superseded") {
    score *= SUPERSEDED_MULTIPLIER;
  }

  // Additional penalty for high rejection count
  if (input.rejection_count >= HIGH_REJECTION_THRESHOLD) {
    score *= HIGH_REJECTION_PENALTY;
  }

  return parseFloat(Math.max(0, Math.min(1, score)).toFixed(4));
}
