/**
 * Safe truth update wrappers — adds timeouts and structured fallback
 * logging around contradiction resolution and stale fact review.
 *
 * Fallback rules:
 *   - If truth ranking fails → retrieval continues with base hybrid ranking
 *     (handled in retrieval-orchestrator's fallbacks.ts)
 *   - If contradiction resolution times out → transaction rolls back,
 *     sweep retries on the next scheduled interval
 *   - If stale fact review times out → same as above
 *   - Individual fact updates that fail do not crash the sweep
 */

import { PoolClient } from "pg";
import {
  createLogger,
  withTimeout,
  TimeoutError,
} from "@hybrid-memory/observability";
import { resolveContradictions } from "../jobs/resolve_contradictions";
import { reviewStaleFacts } from "../jobs/stale_fact_review";
import { getEnv } from "../config/env";

const log = createLogger("truth-worker", "safeTruthUpdate");

/**
 * Run contradiction resolution with a timeout guard.
 * If the sweep exceeds TRUTH_SWEEP_TIMEOUT_MS, the transaction
 * is rolled back and the sweep retries on the next interval.
 */
export async function safeResolveContradictions(
  client: PoolClient,
  batchSize: number
): Promise<number> {
  const env = getEnv();

  try {
    return await withTimeout(
      resolveContradictions(client, batchSize),
      env.TRUTH_SWEEP_TIMEOUT_MS,
      "contradiction_resolution"
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      log.error("contradiction_resolution_timeout", {
        timeout_ms: env.TRUTH_SWEEP_TIMEOUT_MS,
        batch_size: batchSize,
      });
    } else {
      log.error("contradiction_resolution_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}

/**
 * Run stale fact review with a timeout guard.
 * If the sweep exceeds TRUTH_SWEEP_TIMEOUT_MS, the transaction
 * is rolled back and the sweep retries on the next interval.
 */
export async function safeReviewStaleFacts(
  client: PoolClient,
  batchSize: number
): Promise<number> {
  const env = getEnv();

  try {
    return await withTimeout(
      reviewStaleFacts(client, batchSize),
      env.TRUTH_SWEEP_TIMEOUT_MS,
      "stale_fact_review"
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      log.error("stale_fact_review_timeout", {
        timeout_ms: env.TRUTH_SWEEP_TIMEOUT_MS,
        batch_size: batchSize,
      });
    } else {
      log.error("stale_fact_review_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  }
}
