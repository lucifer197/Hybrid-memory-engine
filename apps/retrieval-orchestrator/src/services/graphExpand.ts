import { fetchEdgesFromSeeds, type EdgeRow } from "../repositories/graphRepo";
import { withTimeout } from "@hybrid-memory/observability";
import { getEnv } from "../config/env";

/** A candidate discovered via graph expansion. */
export interface GraphCandidate {
  memory_id: string;
  graph_score: number;
  hop_depth: number;
  /** The edge that led to this candidate (for debug). */
  via_edge_type?: string;
}

/** Configuration for graph expansion. */
export interface GraphExpandOptions {
  /** Max neighbors fetched per seed memory. Default 5. */
  maxNeighborsPerSeed?: number;
  /** Max total expanded candidates returned. Default 50. */
  maxTotalCandidates?: number;
  /** Hop penalty multiplier per hop level. Default 0.5. */
  hopPenalty?: number;
  /** Max hops from seed. Default 1. Multi-hop is a future enhancement. */
  maxHops?: number;
}

const DEFAULTS: Required<GraphExpandOptions> = {
  maxNeighborsPerSeed: 5,
  maxTotalCandidates: 50,
  hopPenalty: 0.5,
  maxHops: 1,
};

/**
 * Expand from seed memory IDs by traversing graph edges (1 hop for MVP).
 *
 * For each seed, fetch top neighbors by edge weight.
 * Neighbor graph_score = edge.weight (hop 1).
 *
 * If a memory appears as a neighbor of multiple seeds, keep the best score.
 * Seed memories themselves are excluded from graph candidates
 * (they already have a vector_score).
 */
export async function graphExpand(
  tenantId: string,
  workspaceId: string,
  seedMemoryIds: string[],
  options?: GraphExpandOptions
): Promise<GraphCandidate[]> {
  const opts = { ...DEFAULTS, ...options };

  if (seedMemoryIds.length === 0) return [];

  // Guard: if maxHops is configured to 0, skip graph expansion entirely
  if (opts.maxHops < 1) return [];

  const seedSet = new Set(seedMemoryIds);

  // ── Hop 1 ─────────────────────────────────────────────────
  const env = getEnv();
  const edges: EdgeRow[] = await withTimeout(
    fetchEdgesFromSeeds(
      tenantId,
      workspaceId,
      seedMemoryIds,
      opts.maxNeighborsPerSeed
    ),
    env.GRAPH_EXPAND_TIMEOUT_MS,
    "graphExpand"
  );

  // Deduplicate: keep best graph_score per memory_id
  const candidateMap = new Map<string, GraphCandidate>();

  for (const edge of edges) {
    const neighborId = edge.dst_memory_id;

    // Skip seeds — they'll get their vector_score directly
    if (seedSet.has(neighborId)) continue;

    const score = edge.weight; // hop 1: no penalty

    const existing = candidateMap.get(neighborId);
    if (!existing || score > existing.graph_score) {
      candidateMap.set(neighborId, {
        memory_id: neighborId,
        graph_score: score,
        hop_depth: 1,
        via_edge_type: edge.edge_type,
      });
    }
  }

  // Sort by graph_score DESC, trim to max
  return [...candidateMap.values()]
    .sort((a, b) => b.graph_score - a.graph_score)
    .slice(0, opts.maxTotalCandidates);
}
