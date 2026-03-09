import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://hybrid:hybrid@localhost:5432/hybrid_memory"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Max similar_to edges per memory */
  SIMILAR_EDGE_LIMIT: z.coerce.number().int().min(1).default(5),
  /** Minimum cosine similarity to create a similar_to edge */
  SIMILAR_EDGE_THRESHOLD: z.coerce.number().default(0.3),
  /** Structured log level. Default "info". */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Max job attempts before sending to DLQ. Default 3. */
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  /** Timeout for a single graph-build job in ms. Default 15000. */
  GRAPH_JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
