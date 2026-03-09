import OpenAI from "openai";
import { getEnv } from "../config/env";
import {
  createLogger,
  withTimeout,
  withRetry,
  CircuitBreaker,
  CircuitBreakerOpenError,
  TimeoutError,
} from "@hybrid-memory/observability";
import { timeoutTotal, retryAttemptTotal, cbStateChange } from "../observability/metrics";
import { getOrEmbed } from "../cache/queryEmbeddingCache";

const log = createLogger("retrieval-orchestrator", "embeddingProvider");

const embeddingBreaker = new CircuitBreaker({
  name: "embedding_provider",
  failureThreshold: getEnv().CB_EMBED_FAILURE_THRESHOLD,
  resetTimeoutMs: getEnv().CB_EMBED_RESET_MS,
  onStateChange: (name, from, to) => {
    cbStateChange.inc({ breaker: name, to });
    log.warn("circuit_breaker_transition", { breaker: name, from, to });
  },
});

/**
 * Generate a query embedding vector.
 * In MOCK mode, returns a deterministic vector seeded by the text hash.
 *
 * Composition: withRetry → CircuitBreaker → withTimeout → OpenAI call.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const env = getEnv();

  // Mock mode bypasses cache (already deterministic, no cost saving)
  if (env.MOCK_EMBEDDINGS) {
    return mockEmbedding(text, env.EMBEDDING_DIM);
  }

  return getOrEmbed(text, () =>
    withRetry(
      () =>
        embeddingBreaker.execute(() =>
          withTimeout(
            new OpenAI({ apiKey: env.OPENAI_API_KEY })
              .embeddings.create({ model: env.EMBEDDING_MODEL, input: text })
              .then((res) => res.data[0].embedding),
            env.EMBED_TIMEOUT_MS,
            "embedQuery"
          )
        ),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        shouldRetry: (err) => {
          if (err instanceof CircuitBreakerOpenError) return false;
          if (err instanceof TimeoutError) return true;
          if (
            err &&
            typeof (err as any).status === "number" &&
            (err as any).status < 500
          )
            return false;
          return true;
        },
        onRetry: (err, attempt, delay) => {
          retryAttemptTotal.inc({ operation: "embedQuery" });
          if (err instanceof TimeoutError) {
            timeoutTotal.inc({ operation: "embedQuery" });
          }
          log.warn("embed_query_retry", {
            attempt,
            delay_ms: delay,
            error: err instanceof Error ? err.message : String(err),
          });
        },
      }
    )
  );
}

/** Deterministic mock — same text always yields same vector. */
function mockEmbedding(text: string, dim: number): number[] {
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
  }

  const vec: number[] = [];
  for (let i = 0; i < dim; i++) {
    // Simple LCG PRNG
    seed = (seed * 1664525 + 1013904223) | 0;
    vec.push(((seed >>> 0) / 0xffffffff) * 2 - 1);
  }

  // Normalize to unit vector
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}
