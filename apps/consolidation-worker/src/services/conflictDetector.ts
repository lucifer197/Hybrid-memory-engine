import { createLogger } from "@hybrid-memory/observability";
import type { SemanticFactRow } from "../repositories/factRepo";
import type { ExtractedFact } from "./factExtractor";

const log = createLogger("consolidation-worker", "conflictDetector");

export type ConflictResult =
  | { kind: "no_conflict" }
  | { kind: "reinforcement"; existingFact: SemanticFactRow }
  | { kind: "contradiction"; existingFact: SemanticFactRow }
  | { kind: "uncertainty"; existingFact: SemanticFactRow };

/**
 * Context about the source memory, used for recency and override detection.
 */
export interface ConflictContext {
  /** The raw content of the memory that produced this candidate. */
  sourceContent: string;
  /** When the source memory was created. */
  sourceCreatedAt: Date;
}

/** How many days since a date. */
function daysSince(d: Date): number {
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
}

// ── Explicit-override phrases (Rule 3) ─────────────────────────
const OVERRIDE_PATTERNS = [
  /\bactually\b/i,
  /\bchanged\b/i,
  /\bnot anymore\b/i,
  /\bno longer\b/i,
  /\binstead\b/i,
  /\bswitch(?:ed|ing)?\s+(?:to|from)\b/i,
  /\bcorrection\b/i,
  /\bupdate[d]?\s+(?:my|the)\b/i,
  /\bI\s+now\s+(?:use|prefer|like)\b/i,
];

function containsExplicitOverride(text: string): boolean {
  return OVERRIDE_PATTERNS.some((p) => p.test(text));
}

/**
 * Determine the relationship between a newly extracted fact and an
 * existing active fact with the same subject+predicate.
 *
 * Belief-revision rules (evaluated in priority order):
 *
 *   Rule 3 — Explicit overrides win
 *     If the source text contains "actually", "changed", "not anymore",
 *     etc., always supersede regardless of confidence.
 *
 *   Rule 0 — Same value → reinforcement
 *     Identical normalized values = merge evidence, bump confidence.
 *
 *   Rule 1 — Recency wins when confidence is close
 *     If the old fact hasn't been confirmed recently (>7 days) and the
 *     new memory is fresh, treat as contradiction (supersede).
 *
 *   Rule 2 — Confirmation beats contradiction
 *     If the old fact has been reinforced many times (high confidence ≥0.8)
 *     and the new fact has only baseline confidence, mark contested rather
 *     than replacing immediately.
 *
 *   Rule 4 — Both high confidence, different values → contested
 *     Neither side can win automatically; requires user confirmation.
 *
 *   Fallback — Confidence gap
 *     Large gap in favour of new fact → contradiction (supersede).
 *     Otherwise → uncertainty (contested).
 */
export function detectConflict(
  extracted: ExtractedFact,
  existing: SemanticFactRow | null,
  ctx?: ConflictContext
): ConflictResult {
  if (!existing) {
    return { kind: "no_conflict" };
  }

  const normalizedNew = normalizeValue(extracted.value_text);
  const normalizedOld = normalizeValue(existing.value_text);

  // ── Rule 3: Explicit override language ─────────────────────
  if (ctx && containsExplicitOverride(ctx.sourceContent)) {
    log.info("conflict_explicit_override", {
      subject: extracted.subject,
      predicate: extracted.predicate,
      old_value: existing.value_text,
      new_value: extracted.value_text,
    });
    return { kind: "contradiction", existingFact: existing };
  }

  // ── Rule 0: Same value → reinforcement ─────────────────────
  if (normalizedNew === normalizedOld) {
    log.debug("conflict_reinforcement", {
      subject: extracted.subject,
      predicate: extracted.predicate,
      fact_id: existing.fact_id,
    });
    return { kind: "reinforcement", existingFact: existing };
  }

  // ── Rule 1: Recency wins when confidence is close ──────────
  if (ctx) {
    const oldStaleDays = daysSince(existing.last_confirmed_at);
    const newIsFresh = daysSince(ctx.sourceCreatedAt) < 1;
    const confidenceClose =
      Math.abs(extracted.confidence - existing.confidence) <= 0.2;

    if (confidenceClose && newIsFresh && oldStaleDays > 7) {
      log.info("conflict_recency_override", {
        subject: extracted.subject,
        predicate: extracted.predicate,
        old_value: existing.value_text,
        new_value: extracted.value_text,
        old_stale_days: Math.round(oldStaleDays),
      });
      return { kind: "contradiction", existingFact: existing };
    }
  }

  // ── Rule 2: Confirmation beats contradiction ───────────────
  // High-confidence existing fact (≥0.8) with many reinforcements
  // vs. a single new observation at baseline confidence.
  if (existing.confidence >= 0.8 && extracted.confidence < 0.8) {
    log.info("conflict_well_confirmed", {
      subject: extracted.subject,
      predicate: extracted.predicate,
      old_value: existing.value_text,
      old_confidence: existing.confidence,
      new_value: extracted.value_text,
      new_confidence: extracted.confidence,
    });
    return { kind: "uncertainty", existingFact: existing };
  }

  // ── Rule 4: Both high confidence → contested ──────────────
  if (existing.confidence >= 0.7 && extracted.confidence >= 0.7) {
    log.info("conflict_both_high", {
      subject: extracted.subject,
      predicate: extracted.predicate,
      old_value: existing.value_text,
      old_confidence: existing.confidence,
      new_value: extracted.value_text,
      new_confidence: extracted.confidence,
    });
    return { kind: "uncertainty", existingFact: existing };
  }

  // ── Fallback: confidence gap ───────────────────────────────
  const confidenceGap = extracted.confidence - existing.confidence;

  if (confidenceGap > 0.2) {
    log.info("conflict_contradiction", {
      subject: extracted.subject,
      predicate: extracted.predicate,
      old_value: existing.value_text,
      new_value: extracted.value_text,
      confidence_gap: confidenceGap,
    });
    return { kind: "contradiction", existingFact: existing };
  }

  // Default: uncertainty
  log.info("conflict_uncertainty", {
    subject: extracted.subject,
    predicate: extracted.predicate,
    old_value: existing.value_text,
    new_value: extracted.value_text,
    old_confidence: existing.confidence,
    new_confidence: extracted.confidence,
  });
  return { kind: "uncertainty", existingFact: existing };
}

/** Normalize a value for comparison: trim, lowercase, collapse whitespace. */
function normalizeValue(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}
