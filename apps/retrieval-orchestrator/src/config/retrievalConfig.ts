import { getRetrievalConfig, type RetrievalConfigRow } from "../repositories/configRepo";
import { createLogger } from "@hybrid-memory/observability";
import { configCacheHits, configCacheMisses } from "../observability/metrics";

const log = createLogger("retrieval-orchestrator", "retrievalConfig");

/**
 * Resolved retrieval configuration — all fields guaranteed present.
 * Used by scoring, graph expansion, and retrieval pipeline.
 */
export interface RetrievalConfig {
  // Fusion weights
  vectorWeight: number;
  graphWeight: number;
  recencyWeight: number;
  stabilityWeight: number;
  importanceWeight: number;

  // Penalties
  archivedPenalty: number;

  // Recency half-lives (hours)
  recencyHalfLifeEpisodicHours: number;
  recencyHalfLifeSemanticHours: number;

  // Graph expansion limits
  maxNeighborsPerSeed: number;
  maxGraphCandidates: number;
  maxHops: number;

  // Retrieval limits
  maxCandidates: number;
  maxChunksPerMemory: number;
}

/** Hard-coded defaults — used when no DB config exists for a tenant. */
const DEFAULTS: RetrievalConfig = {
  vectorWeight: 0.55,
  graphWeight: 0.20,
  recencyWeight: 0.15,
  stabilityWeight: 0.07,
  importanceWeight: 0.03,

  archivedPenalty: 0.70,

  recencyHalfLifeEpisodicHours: 72,
  recencyHalfLifeSemanticHours: 720,

  maxNeighborsPerSeed: 5,
  maxGraphCandidates: 50,
  maxHops: 1,

  maxCandidates: 100,
  maxChunksPerMemory: 2,
};

/** Cache entry with TTL tracking. */
interface CacheEntry {
  config: RetrievalConfig;
  fetchedAt: number;
}

/** How long a cached config is considered fresh (ms). */
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * In-memory cache keyed by "tenant_id:workspace_id".
 * Each entry expires after CACHE_TTL_MS and is re-fetched on next access.
 */
const cache = new Map<string, CacheEntry>();

/**
 * Get the retrieval config for a tenant+workspace.
 *
 * - Checks in-memory cache first (TTL = 1 minute).
 * - Falls back to DB lookup.
 * - Falls back to hard-coded DEFAULTS if no DB row exists.
 * - DB errors are non-fatal (returns defaults + logs warning).
 */
export async function getRetrievalConfigForTenant(
  tenantId: string,
  workspaceId: string
): Promise<RetrievalConfig> {
  const cacheKey = `${tenantId}:${workspaceId}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    configCacheHits.inc();
    return cached.config;
  }
  configCacheMisses.inc();

  // Fetch from DB
  try {
    const row = await getRetrievalConfig(tenantId, workspaceId);
    const config = row ? rowToConfig(row) : { ...DEFAULTS };

    cache.set(cacheKey, { config, fetchedAt: Date.now() });
    return config;
  } catch (err) {
    log.warn("config_fetch_failed", {
      cache_key: cacheKey,
      error: err instanceof Error ? err.message : String(err),
    });
    // Return cached value if available (even if stale), otherwise defaults
    return cached?.config ?? { ...DEFAULTS };
  }
}

/**
 * Get the hard-coded defaults (useful for tests and initial setup).
 */
export function getDefaultRetrievalConfig(): RetrievalConfig {
  return { ...DEFAULTS };
}

/**
 * Invalidate the cache for a specific tenant+workspace.
 * Called after an admin config update.
 */
export function invalidateConfigCache(tenantId: string, workspaceId: string): void {
  cache.delete(`${tenantId}:${workspaceId}`);
}

/**
 * Clear the entire config cache (e.g. for tests).
 */
export function clearConfigCache(): void {
  cache.clear();
}

/** Map a DB row to the camelCase config interface. */
function rowToConfig(row: RetrievalConfigRow): RetrievalConfig {
  return {
    vectorWeight: row.vector_weight,
    graphWeight: row.graph_weight,
    recencyWeight: row.recency_weight,
    stabilityWeight: row.stability_weight,
    importanceWeight: row.importance_weight,

    archivedPenalty: row.archived_penalty,

    recencyHalfLifeEpisodicHours: row.recency_half_life_episodic_hours,
    recencyHalfLifeSemanticHours: row.recency_half_life_semantic_hours,

    maxNeighborsPerSeed: row.max_neighbors_per_seed,
    maxGraphCandidates: row.max_graph_candidates,
    maxHops: row.max_hops,

    maxCandidates: row.max_candidates,
    maxChunksPerMemory: row.max_chunks_per_memory,
  };
}
