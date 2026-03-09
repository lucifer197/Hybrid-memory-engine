import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://hybrid:hybrid@localhost:5432/hybrid_memory"),
  PORT: z.coerce.number().int().default(3002),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  OPENAI_API_KEY: z.string().default(""),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIM: z.coerce.number().int().default(1536),
  MOCK_EMBEDDINGS: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  // ── Timeout configuration ────────────────────────────
  EMBED_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  VECTOR_SEARCH_TIMEOUT_MS: z.coerce.number().int().default(5_000),
  GRAPH_EXPAND_TIMEOUT_MS: z.coerce.number().int().default(3_000),
  /** Overall retrieval timeout (ms). Default 10s. */
  RETRIEVAL_TIMEOUT_MS: z.coerce.number().int().default(10_000),
  /** Fact lookup timeout (ms). Default 3s. */
  FACT_LOOKUP_TIMEOUT_MS: z.coerce.number().int().default(3_000),

  // ── Circuit breaker configuration ────────────────────
  CB_EMBED_FAILURE_THRESHOLD: z.coerce.number().int().default(5),
  CB_EMBED_RESET_MS: z.coerce.number().int().default(30_000),
  CB_GRAPH_FAILURE_THRESHOLD: z.coerce.number().int().default(3),
  CB_GRAPH_RESET_MS: z.coerce.number().int().default(20_000),

  // ── Cache configuration ────────────────────────────
  /** Query embedding cache TTL in ms. Default 5 minutes. */
  EMBED_CACHE_TTL_MS: z.coerce.number().int().default(300_000),
  /** Max entries in query embedding cache. Default 500. */
  EMBED_CACHE_MAX_SIZE: z.coerce.number().int().default(500),
  /** Retrieval result cache TTL in ms. Default 30 seconds. */
  RETRIEVAL_CACHE_TTL_MS: z.coerce.number().int().default(30_000),
  /** Max entries in retrieval result cache. Default 200. */
  RETRIEVAL_CACHE_MAX_SIZE: z.coerce.number().int().default(200),

  // ── Redis ──────────────────────────────────────────
  REDIS_URL: z.string().default("redis://localhost:6379"),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
