import Redis from "ioredis";
import express from "express";
import { getEnv } from "./config/env";
import { buildGraphForMemory } from "./jobs/build_graph_for_memory";
import { closePool } from "./db";
import { createWorkerHealthRoutes } from "./health";
import type { GraphJob } from "@hybrid-memory/shared-types";
import {
  createLogger,
  runWithTraceAsync,
  withTimeout,
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
  graphJobSuccess,
  graphJobFailure,
  graphJobLatency,
  queueDepth,
  dlqDepth,
  jobRetryTotal,
  jobDlqTotal,
  jobPoisonTotal,
} from "./observability/metrics";

const log = createLogger("graph-worker", "main");
const QUEUE_KEY = "graph:jobs";
const DLQ_KEY = "graph:dlq";

async function main() {
  const env = getEnv();

  log.info("starting", {
    redis_url: env.REDIS_URL,
    postgres_url: env.DATABASE_URL.replace(/:[^@]*@/, ":***@"),
    similar_edge_limit: env.SIMILAR_EDGE_LIMIT,
    similar_edge_threshold: env.SIMILAR_EDGE_THRESHOLD,
    job_max_attempts: env.JOB_MAX_ATTEMPTS,
    graph_job_timeout_ms: env.GRAPH_JOB_TIMEOUT_MS,
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
  const HTTP_PORT = parseInt(process.env.METRICS_PORT ?? "3003", 10);
  app.listen(HTTP_PORT, () => {
    log.info("metrics_server_started", { port: HTTP_PORT });
  });

  // Graceful shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info("shutting_down");
    await redis.quit();
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.info("listening", { queue: QUEUE_KEY });

  // ── BRPOP loop ──────────────────────────────────────────────
  while (!stopping) {
    try {
      // Sample queue depths on each iteration
      queueDepth.set(await redis.llen(QUEUE_KEY));
      dlqDepth.set(await redis.llen(DLQ_KEY));

      // Block for up to 5 seconds waiting for a job
      const result = await redis.brpop(QUEUE_KEY, 5);

      if (!result) {
        // Timeout — loop again
        continue;
      }

      const [, payload] = result;
      let job: GraphJob & Record<string, unknown>;

      try {
        job = JSON.parse(payload) as GraphJob & Record<string, unknown>;
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

      const jobStart = performance.now();
      const traceId = job.trace_id;

      await runWithTraceAsync("graph-worker", async () => {
        try {
          await withTimeout(
            buildGraphForMemory(job),
            env.GRAPH_JOB_TIMEOUT_MS,
            "graph_job"
          );
          graphJobSuccess.inc();
        } catch (err) {
          graphJobFailure.inc();
          log.error("job_failed", {
            memory_id: job.memory_id,
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
            const dlqEntry = buildDeadLetterEntry("graph", QUEUE_KEY, job, err);
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

      graphJobLatency.observe(performance.now() - jobStart);
    } catch (err) {
      // Don't crash the worker — log and keep looping
      log.error("loop_error", { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
