import { createHash } from "node:crypto";
import type { RetrieveResult } from "../services/retrieveContextService";
import { getEnv } from "../config/env";
import { retrievalCacheHits, retrievalCacheMisses } from "../observability/metrics";

interface CacheEntry {
  result: RetrieveResult;
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Build a deterministic cache key from retrieval request parameters.
 */
export function buildRetrievalCacheKey(params: {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  query: string;
  filters?: unknown;
  k?: number;
}): string {
  const raw = JSON.stringify({
    t: params.tenant_id,
    w: params.workspace_id,
    u: params.user_id,
    q: params.query,
    f: params.filters ?? null,
    k: params.k ?? 8,
  });
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Evict the oldest entry when cache exceeds max size.
 */
function evictIfNeeded(maxSize: number): void {
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    } else {
      break;
    }
  }
}

/**
 * Look up a cached retrieval result by key.
 * Returns null on miss or expiry.
 */
export function getCachedRetrieval(key: string): RetrieveResult | null {
  const env = getEnv();
  const entry = cache.get(key);

  if (!entry) {
    retrievalCacheMisses.inc();
    return null;
  }

  if (Date.now() - entry.createdAt >= env.RETRIEVAL_CACHE_TTL_MS) {
    cache.delete(key);
    retrievalCacheMisses.inc();
    return null;
  }

  retrievalCacheHits.inc();
  return entry.result;
}

/**
 * Store a retrieval result in the cache.
 */
export function setCachedRetrieval(key: string, result: RetrieveResult): void {
  const env = getEnv();
  cache.set(key, { result, createdAt: Date.now() });
  evictIfNeeded(env.RETRIEVAL_CACHE_MAX_SIZE);
}

/** Clear the retrieval cache (for tests). */
export function clearRetrievalCache(): void {
  cache.clear();
}
