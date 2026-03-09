import { createHash } from "node:crypto";
import { getEnv } from "../config/env";
import { embedCacheHits, embedCacheMisses } from "../observability/metrics";

interface CacheEntry {
  embedding: number[];
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Evict the oldest entry when cache exceeds max size.
 * Map preserves insertion order, so the first key is the oldest.
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
 * Get a cached embedding or generate one via `embedFn`.
 *
 * Cache key is SHA-256 of the query text.
 * TTL and max entries are configured via env vars.
 */
export async function getOrEmbed(
  text: string,
  embedFn: () => Promise<number[]>
): Promise<number[]> {
  const env = getEnv();
  const key = hashText(text);
  const now = Date.now();

  const entry = cache.get(key);
  if (entry && now - entry.createdAt < env.EMBED_CACHE_TTL_MS) {
    embedCacheHits.inc();
    return entry.embedding;
  }

  // Cache miss or expired — generate fresh embedding
  embedCacheMisses.inc();
  if (entry) cache.delete(key); // remove stale entry

  const embedding = await embedFn();

  cache.set(key, { embedding, createdAt: now });
  evictIfNeeded(env.EMBED_CACHE_MAX_SIZE);

  return embedding;
}

/** Clear the embedding cache (for tests). */
export function clearEmbeddingCache(): void {
  cache.clear();
}
