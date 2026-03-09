/**
 * Truth scoring rules for the knowledge layer.
 *
 * Provides consistent, explainable trust_score computation
 * based on source type, verification history, and contradictions.
 */

// ── A) Base trust by source type ─────────────────────────────

const BASE_TRUST: Record<string, number> = {
  tool: 0.95,
  user: 0.85,
  system: 0.80,
  assistant: 0.55,
};

export function baseTrustForSource(sourceType: string): number {
  return BASE_TRUST[sourceType] ?? BASE_TRUST.assistant;
}

// ── B) Verification boosts ──────────────────────────────────

export const VERIFY_TRUST_DELTA = 0.02;
export const VERIFY_CONFIDENCE_DELTA = 0.05;

// ── C) Rejection penalties ──────────────────────────────────

export const REJECT_TRUST_DELTA = -0.05;
export const REJECT_CONFIDENCE_DELTA = -0.10;

// ── D) Contradiction handling ───────────────────────────────

/**
 * Determine the truth_status outcome when a contradiction is detected.
 * @param isExplicitOverride  true if the new fact explicitly overrides ("actually", "changed to", etc.)
 */
export function contradictionTruthStatus(isExplicitOverride: boolean): "superseded" | "contested" {
  return isExplicitOverride ? "superseded" : "contested";
}

// ── E) Rate limiting ────────────────────────────────────────

const FEEDBACK_COOLDOWN_MS = 30_000; // 30 seconds

/**
 * Returns true if a new feedback event should be ignored (too recent).
 */
export function isFeedbackRateLimited(
  lastFeedbackAt: Date | null
): boolean {
  if (!lastFeedbackAt) return false;
  return Date.now() - lastFeedbackAt.getTime() < FEEDBACK_COOLDOWN_MS;
}

// ── Composite trust recalculation ───────────────────────────

/**
 * Recompute trust_score from components.
 * This is a pure function — no DB access.
 *
 *   trust = baseTrust
 *         + (verifications × VERIFY_TRUST_DELTA)
 *         - (rejections × |REJECT_TRUST_DELTA|)
 *         - (contradictions × 0.03)
 *
 * Clamped to [0, 1].
 */
export function computeTrustScore(
  sourceType: string,
  verificationCount: number,
  rejectionCount: number,
  contradictionCount: number
): number {
  const base = baseTrustForSource(sourceType);
  const score =
    base +
    verificationCount * VERIFY_TRUST_DELTA -
    rejectionCount * Math.abs(REJECT_TRUST_DELTA) -
    contradictionCount * 0.03;
  return Math.max(0, Math.min(1, score));
}
