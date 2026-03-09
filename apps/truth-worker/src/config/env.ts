import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://hybrid:hybrid@localhost:5432/hybrid_memory"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Interval (seconds) between contradiction resolution sweeps. Default 1800 (30 min). */
  CONTRADICTION_INTERVAL_SEC: z.coerce.number().int().min(60).default(1800),
  /** Interval (seconds) between stale fact reviews. Default 3600 (1 hour). */
  STALE_REVIEW_INTERVAL_SEC: z.coerce.number().int().min(60).default(3600),
  /** Number of days without verification before a fact is considered stale. Default 90. */
  STALE_THRESHOLD_DAYS: z.coerce.number().int().min(1).default(90),
  /** Trust score penalty per stale review cycle. Default 0.03. */
  STALE_TRUST_PENALTY: z.coerce.number().min(0).max(0.5).default(0.03),
  /** Confidence penalty per stale review cycle. Default 0.05. */
  STALE_CONFIDENCE_PENALTY: z.coerce.number().min(0).max(0.5).default(0.05),
  /** Batch size for each sweep. Default 100. */
  BATCH_SIZE: z.coerce.number().int().min(1).default(100),
  /** Minimum trust_score diff to auto-resolve contradictions. Default 0.25. */
  AUTO_RESOLVE_TRUST_GAP: z.coerce.number().min(0).max(1).default(0.25),
  /** Timeout for a single truth sweep transaction (ms). Default 30s. */
  TRUTH_SWEEP_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
