import { PoolClient } from "pg";
import { createLogger } from "@hybrid-memory/observability";
import { getEnv } from "../config/env";
import {
  staleFactsDowngraded,
  staleFactsMarkedUnknown,
} from "../observability/metrics";
import {
  batchDowngradeStaleFacts,
  batchMarkUnknown,
  batchInsertFactEvents,
} from "../repositories/batchRepo";

const log = createLogger("truth-worker", "stale_fact_review");

interface StaleFactRow {
  fact_id: string;
  trust_score: number;
  confidence: number;
  truth_status: string;
  source_type: string;
  verification_count: number;
}

/**
 * Downgrade facts that haven't been verified in STALE_THRESHOLD_DAYS.
 *
 * Uses batch UPDATE and INSERT operations to reduce round-trips
 * from O(2N) to O(3) per sweep.
 *
 * Rules:
 * 1. Apply trust/confidence penalties to stale active facts
 * 2. If trust_score drops below 0.20 → mark as "unknown"
 * 3. Tool-sourced facts decay slower (halved penalty)
 * 4. Facts with high verification_count decay slower
 */
export async function reviewStaleFacts(
  client: PoolClient,
  batchSize: number
): Promise<number> {
  const env = getEnv();

  // Find active facts not verified within threshold
  const { rows: staleFacts } = await client.query<StaleFactRow>(
    `SELECT fact_id, trust_score, confidence, truth_status, source_type, verification_count
     FROM semantic_facts
     WHERE truth_status = 'active'
       AND (
         last_verified_at IS NULL AND created_at < now() - $1::interval
         OR last_verified_at < now() - $1::interval
       )
     ORDER BY trust_score ASC
     LIMIT $2`,
    [`${env.STALE_THRESHOLD_DAYS} days`, batchSize]
  );

  if (staleFacts.length === 0) return 0;

  // ── Classify each fact into downgrade or mark-unknown ────────
  const downgrades: { fact_id: string; new_trust: number; new_confidence: number }[] = [];
  const unknowns: { fact_id: string; new_trust: number; new_confidence: number }[] = [];
  const events: { fact_id: string; event_type: string; delta_confidence: number; metadata: Record<string, unknown> }[] = [];

  for (const fact of staleFacts) {
    let trustPenalty = env.STALE_TRUST_PENALTY;
    let confPenalty = env.STALE_CONFIDENCE_PENALTY;

    if (fact.source_type === "tool" || fact.source_type === "system") {
      trustPenalty *= 0.5;
      confPenalty *= 0.5;
    }
    if (fact.verification_count >= 3) {
      trustPenalty *= 0.5;
      confPenalty *= 0.5;
    }

    const newTrust = Math.max(0, fact.trust_score - trustPenalty);
    const newConfidence = Math.max(0, fact.confidence - confPenalty);

    if (newTrust < 0.20) {
      unknowns.push({ fact_id: fact.fact_id, new_trust: newTrust, new_confidence: newConfidence });
      events.push({
        fact_id: fact.fact_id,
        event_type: "contested",
        delta_confidence: -confPenalty,
        metadata: { source: "truth_worker_stale", new_truth_status: "unknown" },
      });
    } else {
      downgrades.push({ fact_id: fact.fact_id, new_trust: newTrust, new_confidence: newConfidence });
      events.push({
        fact_id: fact.fact_id,
        event_type: "updated",
        delta_confidence: -confPenalty,
        metadata: { source: "truth_worker_stale" },
      });
    }
  }

  // ── Execute batch operations ─────────────────────────────────
  await batchDowngradeStaleFacts(client, downgrades);
  await batchMarkUnknown(client, unknowns);
  await batchInsertFactEvents(client, events);

  // ── Metrics ──────────────────────────────────────────────────
  staleFactsDowngraded.inc({}, downgrades.length);
  staleFactsMarkedUnknown.inc({}, unknowns.length);

  log.info("stale_review_complete", {
    total: staleFacts.length,
    downgraded: downgrades.length,
    marked_unknown: unknowns.length,
  });

  return staleFacts.length;
}
