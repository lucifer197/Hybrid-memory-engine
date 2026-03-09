import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://hybrid:hybrid@localhost:5432/hybrid_memory"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Structured log level. Default "info". */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Max job attempts before sending to DLQ. Default 3. */
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  /** Timeout for a single consolidation job in ms. Default 30000. */
  CONSOLIDATION_JOB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Minimum confidence to auto-accept a new fact. Default 0.6. */
  MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  /** Confidence boost for same-value reinforcement. Default 0.05. */
  REINFORCE_BOOST: z.coerce.number().min(0).max(1).default(0.05),
  /** Confidence boost for explicit user confirmation ("yes", "correct"). Default 0.10. */
  CONFIRM_BOOST: z.coerce.number().min(0).max(1).default(0.10),
  /** Confidence penalty applied to the old fact on contradiction. Default 0.10. */
  CONTRADICTION_PENALTY: z.coerce.number().min(0).max(1).default(0.10),
  /** Interval (seconds) for the scheduled sweep of unconsolidated memories. Default 3600. */
  SWEEP_INTERVAL_SEC: z.coerce.number().int().min(60).default(3600),
  /** Max memories to process per sweep batch. Default 100. */
  SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).default(100),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
