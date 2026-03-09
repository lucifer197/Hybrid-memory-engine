import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://hybrid:hybrid@localhost:5432/hybrid_memory"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // ── Scheduler intervals (seconds) ──────────────────────
  /** How often to run the decay sweep. Default 3600 (1 hour). */
  DECAY_INTERVAL_SEC: z.coerce.number().int().min(10).default(3600),
  /** How often to run archival sweep. Default 3600. */
  ARCHIVE_INTERVAL_SEC: z.coerce.number().int().min(10).default(3600),
  /** How often to run consolidation sweep. Default 7200 (2 hours). */
  CONSOLIDATE_INTERVAL_SEC: z.coerce.number().int().min(10).default(7200),
  /** How often to run the retention sweep. Default 3600 (1 hour). */
  RETENTION_INTERVAL_SEC: z.coerce.number().int().min(10).default(3600),

  // ── Decay tuning ───────────────────────────────────────
  /** Minimum hours since last access before decay applies. Default 24. */
  DECAY_MIN_IDLE_HOURS: z.coerce.number().min(1).default(24),
  /** Stability floor below which decay stops. Default 0.05. */
  DECAY_STABILITY_FLOOR: z.coerce.number().min(0).default(0.05),
  /** During decay: auto-archive if stability drops below this. Default 0.25. */
  DECAY_ARCHIVE_STABILITY: z.coerce.number().min(0).default(0.25),
  /** During decay: auto-archive only if idle > this many days. Default 30. */
  DECAY_ARCHIVE_MIN_AGE_DAYS: z.coerce.number().min(1).default(30),

  // ── Archive tuning ─────────────────────────────────────
  /** Stability threshold below which memories get archived. Default 0.1. */
  ARCHIVE_STABILITY_THRESHOLD: z.coerce.number().min(0).default(0.1),
  /** Minimum days since last access before archival. Default 30. */
  ARCHIVE_MIN_IDLE_DAYS: z.coerce.number().min(1).default(30),
  /** Max memories to archive per sweep. Default 100. */
  ARCHIVE_BATCH_SIZE: z.coerce.number().int().min(1).default(100),

  // ── Reinforcement tuning ───────────────────────────────
  /** Minimum seconds between reinforcements of the same memory. Default 300 (5 min). */
  REINFORCE_COOLDOWN_SEC: z.coerce.number().int().min(0).default(300),
  /** Stability boost per reinforcement. Default 0.1. */
  REINFORCE_STABILITY_DELTA: z.coerce.number().min(0).default(0.1),
  /** Maximum stability score. Default 1.0. */
  REINFORCE_STABILITY_CAP: z.coerce.number().min(0).default(1.0),

  // ── Consolidation tuning ─────────────────────────────
  /** Minimum cluster size (number of episodic memories) to trigger consolidation. Default 3. */
  CONSOLIDATION_MIN_CLUSTER_SIZE: z.coerce.number().int().min(2).default(3),
  /** Minimum similarity weight on similar_to edges for cluster eligibility. Default 0.85. */
  CONSOLIDATION_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  /** Max age in days — only consider episodic memories created within this window. Default 30. */
  CONSOLIDATION_MAX_AGE_DAYS: z.coerce.number().min(1).default(30),
  /** Stability score assigned to newly created consolidated semantic memories. Default 0.7. */
  CONSOLIDATION_INITIAL_STABILITY: z.coerce.number().min(0).max(1).default(0.7),
  /** Max clusters to process per sweep. Default 10. */
  CONSOLIDATION_BATCH_SIZE: z.coerce.number().int().min(1).default(10),
  /** Structured log level. Default "info". */
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Max job attempts before sending to DLQ. Default 3. */
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
});

export type Env = z.infer<typeof EnvSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = EnvSchema.parse(process.env);
  }
  return _env;
}
