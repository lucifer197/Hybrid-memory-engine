import Redis from "ioredis";
import express from "express";
import { getEnv } from "./config/env";
import { getPool, closePool } from "./db";
import { createWorkerHealthRoutes } from "./health";
import { runDecaySweep } from "./jobs/decay_job";
import { runArchiveSweep } from "./jobs/archive_job";
import { runConsolidationSweep } from "./jobs/consolidate_job";
import { runRetentionSweep } from "./jobs/retention_job";
import { processAccessJob } from "./jobs/access_job";
import { processReinforceJob } from "./jobs/reinforce_job";
import type { LifecycleJob } from "@hybrid-memory/shared-types";
import {
  createLogger,
  runWithTraceAsync,
  stampRetryMeta,
  retryOrDlq,
  computeBackoffMs,
  sleep,
  buildDeadLetterEntry,
} from "@hybrid-memory/observability";
import { getRetryPolicy } from "./queue/retryPolicy";
import { persistDeadLetter } from "./queue/deadLetter";
import {
  registry,
  accessJobLatency,
  reinforceJobLatency,
  queueDepth,
  dlqDepth,
  jobRetryTotal,
  jobDlqTotal,
  jobPoisonTotal,
} from "./observability/metrics";

const log = createLogger("lifecycle-worker", "main");
const QUEUE_KEY = "lifecycle:jobs";
const DLQ_KEY = "lifecycle:dlq";

/**
 * Lifecycle Worker — hybrid scheduler + queue consumer.
 *
 * Interval-based sweeps:
 *   - Decay sweep    — reduces stability of idle, non-pinned memories
 *   - Archive sweep  — moves low-stability idle memories to archived status
 *   - Consolidation  — merges highly-similar episodic memories into semantic
 *
 * Queue-based (from retrieval-orchestrator):
 *   - Access jobs    — update last_accessed_at + log access events
 *   - Reinforce jobs — boost stability on top-N retrieval results
 */
async function main(): Promise<void> {
  const env = getEnv();
  getPool(); // eagerly initialize connection pool

  log.info("starting", {
    redis_url: env.REDIS_URL,
    decay_interval_sec: env.DECAY_INTERVAL_SEC,
    archive_interval_sec: env.ARCHIVE_INTERVAL_SEC,
    consolidate_interval_sec: env.CONSOLIDATE_INTERVAL_SEC,
    retention_interval_sec: env.RETENTION_INTERVAL_SEC,
    job_max_attempts: env.JOB_MAX_ATTEMPTS,
  });

  // ── Redis connection ──────────────────────────────────────
  const redis = new Redis(env.REDIS_URL);

  redis.on("connect", () => {
    log.info("redis_connected");
  });
  redis.on("error", (err) => {
    log.error("redis_error", { error: err.message });
  });

  // ── Minimal HTTP server for /health + /metrics ────────
  const { liveness, readiness } = createWorkerHealthRoutes(redis);
  const app = express();
  app.get("/health", liveness);
  app.get("/livez", liveness);
  app.get("/readyz", readiness);
  app.get("/metrics", (_req, res) => res.json(registry.toJSON()));
  const HTTP_PORT = parseInt(process.env.METRICS_PORT ?? "3004", 10);
  app.listen(HTTP_PORT, () => {
    log.info("metrics_server_started", { port: HTTP_PORT });
  });

  // ── Schedule interval sweeps ──────────────────────────────
  const timers: NodeJS.Timeout[] = [];

  timers.push(
    setInterval(async () => {
      await runWithTraceAsync("lifecycle-worker", async () => {
        try {
          await runDecaySweep();
        } catch (err) {
          log.error("decay_sweep_crashed", { error: err instanceof Error ? err.message : String(err) });
        }
      });
    }, env.DECAY_INTERVAL_SEC * 1000)
  );

  timers.push(
    setInterval(async () => {
      await runWithTraceAsync("lifecycle-worker", async () => {
        try {
          await runArchiveSweep();
        } catch (err) {
          log.error("archive_sweep_crashed", { error: err instanceof Error ? err.message : String(err) });
        }
      });
    }, env.ARCHIVE_INTERVAL_SEC * 1000)
  );

  timers.push(
    setInterval(async () => {
      await runWithTraceAsync("lifecycle-worker", async () => {
        try {
          await runConsolidationSweep();
        } catch (err) {
          log.error("consolidation_sweep_crashed", { error: err instanceof Error ? err.message : String(err) });
        }
      });
    }, env.CONSOLIDATE_INTERVAL_SEC * 1000)
  );

  timers.push(
    setInterval(async () => {
      await runWithTraceAsync("lifecycle-worker", async () => {
        try {
          await runRetentionSweep();
        } catch (err) {
          log.error("retention_sweep_crashed", { error: err instanceof Error ? err.message : String(err) });
        }
      });
    }, env.RETENTION_INTERVAL_SEC * 1000)
  );

  // ── Run all sweeps once on startup ────────────────────────
  log.info("running_initial_sweeps");
  await Promise.allSettled([
    runWithTraceAsync("lifecycle-worker", () => runDecaySweep()),
    runWithTraceAsync("lifecycle-worker", () => runArchiveSweep()),
    runWithTraceAsync("lifecycle-worker", () => runConsolidationSweep()),
    runWithTraceAsync("lifecycle-worker", () => runRetentionSweep()),
  ]);
  log.info("initial_sweeps_complete");

  // ── Graceful shutdown ─────────────────────────────────────
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info("shutting_down", { signal });
    for (const t of timers) clearInterval(t);
    await redis.quit();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // ── BRPOP queue consumer ──────────────────────────────────
  log.info("listening", { queue: QUEUE_KEY });

  while (!stopping) {
    try {
      queueDepth.set(await redis.llen(QUEUE_KEY));
      dlqDepth.set(await redis.llen(DLQ_KEY));

      const result = await redis.brpop(QUEUE_KEY, 5);

      if (!result) continue; // timeout — loop again

      const [, payload] = result;
      let job: LifecycleJob & Record<string, unknown>;

      try {
        job = JSON.parse(payload) as LifecycleJob & Record<string, unknown>;
      } catch {
        // Poison message — unparseable JSON → DLQ immediately
        log.error("job_parse_failed", { payload });
        jobPoisonTotal.inc();
        try {
          await redis.lpush(DLQ_KEY, payload);
        } catch (dlqErr) {
          log.error("dlq_push_failed", {
            error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
          });
        }
        continue;
      }

      const traceId = job.trace_id;

      await runWithTraceAsync("lifecycle-worker", async () => {
        const jobStart = performance.now();
        try {
          switch (job.type) {
            case "access":
              await processAccessJob(job);
              accessJobLatency.observe(performance.now() - jobStart);
              break;
            case "reinforce":
              await processReinforceJob(job);
              reinforceJobLatency.observe(performance.now() - jobStart);
              break;
            default:
              log.warn("unknown_job_type", { type: (job as any).type });
          }
        } catch (err) {
          log.error("job_failed", {
            type: job.type,
            error: err instanceof Error ? err.message : String(err),
          });

          // Stamp retry metadata and decide retry vs DLQ
          stampRetryMeta(job, err);
          const policy = getRetryPolicy();
          const decision = retryOrDlq(job, policy.maxAttempts);

          if (decision === "retry") {
            const attempt = (job._attempt_count as number) ?? 1;
            const delayMs = computeBackoffMs(attempt - 1, policy);
            jobRetryTotal.inc();
            log.warn("job_retry", { type: job.type, attempt, backoff_ms: delayMs });
            await sleep(delayMs);
            try {
              await redis.lpush(QUEUE_KEY, JSON.stringify(job));
            } catch (pushErr) {
              log.error("retry_push_failed", {
                error: pushErr instanceof Error ? pushErr.message : String(pushErr),
              });
            }
          } else {
            jobDlqTotal.inc();
            const dlqEntry = buildDeadLetterEntry(`lifecycle_${job.type}`, QUEUE_KEY, job, err);
            log.error("job_sent_to_dlq", {
              type: job.type,
              attempt: job._attempt_count,
              error_message: dlqEntry.error_message,
            });
            try {
              await redis.lpush(DLQ_KEY, JSON.stringify(dlqEntry));
            } catch (dlqErr) {
              log.error("dlq_push_failed", {
                error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
              });
            }
            await persistDeadLetter(dlqEntry);
          }
        }
      }, traceId);
    } catch (err) {
      log.error("loop_error", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
