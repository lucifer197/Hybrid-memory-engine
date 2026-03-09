/**
 * Fallback rules for retrieval pipeline degradation.
 *
 * Each function wraps a pipeline step: if it fails, the pipeline
 * continues in a degraded mode rather than failing entirely.
 *
 * Fallback rules:
 *   - Graph expansion fails  → continue with vector-only results
 *   - Fact lookup fails      → continue with memory retrieval (no facts)
 *   - Truth ranking fails    → continue with base hybrid ranking (confidence only)
 *   - Embedding provider down → retrieval fails (no fallback — must embed to search)
 */

import { createLogger } from "@hybrid-memory/observability";
import type { GraphCandidate } from "./graphExpand";
import type { FactsAssemblyResult } from "./factsAssembler";

const log = createLogger("retrieval-orchestrator", "fallbacks");

/**
 * Wrap graph expansion with a fallback to empty candidates.
 * If graph expansion fails for any reason, retrieval continues with
 * vector-only results instead of failing the whole request.
 */
export async function withGraphFallback(
  fn: () => Promise<GraphCandidate[]>,
  label: string
): Promise<GraphCandidate[]> {
  try {
    return await fn();
  } catch (err) {
    log.warn("graph_expansion_fallback", {
      label,
      error: err instanceof Error ? err.message : String(err),
      fallback: "vector_only",
    });
    return [];
  }
}

/**
 * Wrap fact lookup with a fallback to empty results.
 * If fact assembly fails, retrieval continues without facts.
 */
export async function withFactFallback(
  fn: () => Promise<FactsAssemblyResult>,
  label: string
): Promise<FactsAssemblyResult | null> {
  try {
    return await fn();
  } catch (err) {
    log.warn("fact_lookup_fallback", {
      label,
      error: err instanceof Error ? err.message : String(err),
      fallback: "no_facts",
    });
    return null;
  }
}

/**
 * Wrap truth ranking of a single fact with a fallback to confidence-only scoring.
 * If truth ranking fails, the fact's score is based solely on its confidence value.
 */
export function withTruthRankFallback(
  fn: () => number,
  confidenceFallback: number,
  label: string
): number {
  try {
    return fn();
  } catch (err) {
    log.warn("truth_rank_fallback", {
      label,
      error: err instanceof Error ? err.message : String(err),
      fallback: "confidence_only",
      confidence: confidenceFallback,
    });
    return confidenceFallback;
  }
}
