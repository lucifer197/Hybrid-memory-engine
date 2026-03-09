import Redis from "ioredis";
import express from "express";
import { getEnv } from "./config/env";
import { closePool, withTransaction } from "./db";
import { createWorkerHealthRoutes } from "./health";
import { memoryRepo } from "./repositories/memoryRepo";
import { sweepUnconsolidated } from "./jobs/consolidate_recent";
import { safeConsolidateMemory } from "./services/safeConsolidate";
import type { ConsolidationJob } from "@hybrid-memory/shared-types";
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
  consolidationJobSuccess,
  consolidationJobFailure,
  consolidationJobLatency,
  factsCreated,
  factsReinforced,
  factsSuperseded,
  factsContested,
  factsSkipped,
  sweepLatency,
  sweepMemoriesProcessed,
  queueDepth,
  dlqDepth,
  jobRetryTotal,
  jobDlqTotal,
  jobPoisonTotal,
} from "./observability/metrics";

const log = createLogger("consolidation-worker", "main");
const QUEUE_KEY = "consolidation:jobs";
const DLQ_KEY = "consolidation:dlq";

async function main() {
  const env = getEnv();

  log.info("starting", {
    redis_url: env.REDIS_URL,
    postgres_url: env.DATABASE_URL.replace(/:[^@]*@/, ":***@"),
    job_max_attempts: env.JOB_MAX_ATTEMPTS,
    min_confidence: env.MIN_CONFIDENCE,
    sweep_interval_sec: env.SWEEP_INTERVAL_SEC,
    sweep_batch_size: env.SWEEP_BATCH_SIZE,
  });

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
  const HTTP_PORT = parseInt(process.env.METRICS_PORT ?? "3005", 10);
  app.listen(HTTP_PORT, () => {
    log.info("metrics_server_started", { port: HTTP_PORT });
  });

  // ── Scheduled sweep for unconsolidated memories ───────
  const sweepInterval = setInterval(async () => {
    const start = performance.now();
    try {
      const count = await sweepUnconsolidated(withTransaction, env.SWEEP_BATCH_SIZE);
      sweepMemoriesProcessed.inc(undefined, count);
    } catch (err) {
      log.error("sweep_error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    sweepLatency.observe(performance.now() - start);
  }, env.SWEEP_INTERVAL_SEC * 1000);

  // ── Graceful shutdown ─────────────────────────────────
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info("shutting_down");
    clearInterval(sweepInterval);
    await redis.quit();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.info("listening", { queue: QUEUE_KEY });

  // ── BRPOP loop ────────────────────────────────────────
  while (!stopping) {
    try {
      queueDepth.set(await redis.llen(QUEUE_KEY));
      dlqDepth.set(await redis.llen(DLQ_KEY));

      const result = await redis.brpop(QUEUE_KEY, 5);

      if (!result) {
        continue;
      }

      const [, payload] = result;
      let job: ConsolidationJob & Record<string, unknown>;

      try {
        job = JSON.parse(payload) as ConsolidationJob & Record<string, unknown>;
      } catch {
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

      const jobStart = performance.now();
      const traceId = job.trace_id;

      await runWithTraceAsync("consolidation-worker", async () => {
        try {
          await withTransaction(async (client) => {
              const memory = await memoryRepo.findById(client, job.memory_id);
              if (!memory) {
                log.warn("memory_not_found", { memory_id: job.memory_id });
                return;
              }

              const result = await safeConsolidateMemory(client, memory);

              // Update metrics
              for (const r of result.results) {
                switch (r.action) {
                  case "created":
                    factsCreated.inc();
                    break;
                  case "reinforced":
                    factsReinforced.inc();
                    break;
                  case "superseded":
                    factsSuperseded.inc();
                    break;
                  case "contested":
                    factsContested.inc();
                    break;
                  case "skipped":
                    factsSkipped.inc();
                    break;
                }
              }
            });
          consolidationJobSuccess.inc();
        } catch (err) {
          consolidationJobFailure.inc();
          log.error("job_failed", {
            memory_id: job.memory_id,
            error: err instanceof Error ? err.message : String(err),
          });

          stampRetryMeta(job, err);
          const policy = getRetryPolicy();
          const decision = retryOrDlq(job, policy.maxAttempts);

          if (decision === "retry") {
            const attempt = (job._attempt_count as number) ?? 1;
            const delayMs = computeBackoffMs(attempt - 1, policy);
            jobRetryTotal.inc();
            log.warn("job_retry", {
              memory_id: job.memory_id,
              attempt,
              backoff_ms: delayMs,
            });
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
            const dlqEntry = buildDeadLetterEntry("consolidation", QUEUE_KEY, job, err);
            log.error("job_sent_to_dlq", {
              memory_id: job.memory_id,
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

      consolidationJobLatency.observe(performance.now() - jobStart);
    } catch (err) {
      log.error("loop_error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
