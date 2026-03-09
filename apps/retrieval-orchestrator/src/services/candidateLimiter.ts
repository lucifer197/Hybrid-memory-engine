import { createLogger } from "@hybrid-memory/observability";
import type { GraphCandidate } from "./graphExpand";

const log = createLogger("retrieval-orchestrator", "candidateLimiter");

// ── Hard ceilings for graph expansion output ─────────────────────

/** Absolute max graph candidates regardless of config. */
const HARD_MAX_GRAPH_CANDIDATES = 100;

/** Absolute max neighbors per seed regardless of config. */
const HARD_MAX_NEIGHBORS_PER_SEED = 15;

/** Absolute max hops (future-proofing; 1 for MVP). */
const HARD_MAX_HOPS = 2;

/**
 * Clamp graph expansion options to safe ceilings.
 *
 * Tenant config can lower these values but never exceed the hard caps.
 */
export function clampGraphOptions(opts: {
  maxNeighborsPerSeed: number;
  maxGraphCandidates: number;
  maxHops: number;
}): {
  maxNeighborsPerSeed: number;
  maxGraphCandidates: number;
  maxHops: number;
} {
  const clamped = {
    maxNeighborsPerSeed: Math.min(opts.maxNeighborsPerSeed, HARD_MAX_NEIGHBORS_PER_SEED),
    maxGraphCandidates: Math.min(opts.maxGraphCandidates, HARD_MAX_GRAPH_CANDIDATES),
    maxHops: Math.min(opts.maxHops, HARD_MAX_HOPS),
  };

  if (
    clamped.maxNeighborsPerSeed !== opts.maxNeighborsPerSeed ||
    clamped.maxGraphCandidates !== opts.maxGraphCandidates ||
    clamped.maxHops !== opts.maxHops
  ) {
    log.warn("graph_options_clamped", { requested: opts, clamped });
  }

  return clamped;
}

/**
 * Trim graph candidate list to an absolute ceiling.
 *
 * This is a safety net applied after graphExpand() returns,
 * in case the expansion function itself doesn't enforce limits tightly.
 */
export function trimGraphCandidates(
  candidates: GraphCandidate[],
  limit = HARD_MAX_GRAPH_CANDIDATES
): GraphCandidate[] {
  if (candidates.length <= limit) return candidates;

  log.warn("graph_candidates_trimmed", {
    original: candidates.length,
    limit,
  });
  return candidates.slice(0, limit);
}
