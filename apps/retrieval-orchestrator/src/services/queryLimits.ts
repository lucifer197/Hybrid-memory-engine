import type { RetrieveContextRequest } from "@hybrid-memory/shared-types";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("retrieval-orchestrator", "queryLimits");

// ── Hard ceilings ────────────────────────────────────────────────
// These cannot be overridden by tenant config or request params.

/** Absolute max K a client can request. */
const MAX_K = 50;
/** Default K when not specified. */
const DEFAULT_K = 8;
/** Minimum K (floor). */
const MIN_K = 1;

/** Max vector candidates fetched (k * multiplier, capped). */
const MAX_VECTOR_CANDIDATES = 200;
/** Multiplier: fetch this many times K from the vector index. */
const VECTOR_CANDIDATE_MULTIPLIER = 3;

/** Max seed memory IDs sent to graph expansion. */
const MAX_GRAPH_SEEDS = 30;

/** Max characters of content_raw to load for graph-only neighbors. */
export const GRAPH_ONLY_CONTENT_LIMIT = 500;

/**
 * Sanitized retrieval parameters with safe limits enforced.
 */
export interface SanitizedQueryParams {
  k: number;
  vectorLimit: number;
  maxGraphSeeds: number;
}

/**
 * Clamp and sanitize query parameters from the client request.
 *
 * - Caps K to MAX_K
 * - Computes vector candidate limit (k * 3, capped at MAX_VECTOR_CANDIDATES)
 * - Caps graph seed count
 * - Logs a warning when client values are clamped
 */
export function sanitizeQueryParams(
  req: RetrieveContextRequest,
  maxCandidatesFromConfig: number
): SanitizedQueryParams {
  const rawK = req.k ?? DEFAULT_K;
  const k = Math.max(MIN_K, Math.min(MAX_K, rawK));

  if (rawK !== k) {
    log.warn("k_clamped", { requested: rawK, clamped: k });
  }

  const vectorLimit = Math.min(
    k * VECTOR_CANDIDATE_MULTIPLIER,
    maxCandidatesFromConfig,
    MAX_VECTOR_CANDIDATES
  );

  return {
    k,
    vectorLimit,
    maxGraphSeeds: MAX_GRAPH_SEEDS,
  };
}
