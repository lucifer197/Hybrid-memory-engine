import express from "express";
import { getEnv } from "./config/env";
import { closePool, withTransaction } from "./db";
import { liveness, readiness } from "./health";
import { safeResolveContradictions, safeReviewStaleFacts } from "./services/safeTruthUpdate";
import {
  createLogger,
  buildDeadLetterEntry,
  computeBackoffMs,
  sleep,
} from "@hybrid-memory/observability";
import { getRetryPolicy } from "./queue/retryPolicy";
import { persistDeadLetter } from "./queue/deadLetter";
import {
  registry,
  contradictionSweepLatency,
  staleSweepLatency,
} from "./observability/metrics";

const log = createLogger("truth-worker", "main");

async function main() {
  const env = getEnv();

  log.info("starting", {
    postgres_url: env.DATABASE_URL.replace(/:[^@]*@/, ":***@"),
    contradiction_interval_sec: env.CONTRADICTION_INTERVAL_SEC,
    stale_review_interval_sec: env.STALE_REVIEW_INTERVAL_SEC,
    stale_threshold_days: env.STALE_THRESHOLD_DAYS,
    batch_size: env.BATCH_SIZE,
  });

  // ── Minimal HTTP server for /health + /metrics ────────
  const app = express();
  app.get("/health", liveness);
  app.get("/livez", liveness);
  app.get("/readyz", readiness);
  app.get("/metrics", (_req, res) => res.json(registry.toJSON()));
  const HTTP_PORT = parseInt(process.env.METRICS_PORT ?? "3006", 10);
  app.listen(HTTP_PORT, () => {
    log.info("metrics_server_started", { port: HTTP_PORT });
  });

  const policy = getRetryPolicy();

  async function runWithRetry(
    sweepName: string,
    fn: () => Promise<void>,
    latencyMetric: { observe(v: number): void },
  ) {
    const start = performance.now();
    let lastErr: unknown;
    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        await fn();
        latencyMetric.observe(performance.now() - start);
        return;
      } catch (err) {
        lastErr = err;
        log.error(`${sweepName}_error`, {
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          attempt: attempt + 1,
        });
        if (attempt + 1 < policy.maxAttempts) {
          const delayMs = computeBackoffMs(attempt, policy);
          log.warn(`${sweepName}_retry`, { attempt: attempt + 1, backoff_ms: delayMs });
          await sleep(delayMs);
        }
      }
    }
    latencyMetric.observe(performance.now() - start);
    // All retries exhausted — persist to DLQ table
    const dlqEntry = buildDeadLetterEntry(
      sweepName, "scheduled", { sweep: sweepName, batch_size: env.BATCH_SIZE }, lastErr
    );
    log.error(`${sweepName}_sent_to_dlq`, {
      attempt: policy.maxAttempts,
      error_message: dlqEntry.error_message,
    });
    await persistDeadLetter(dlqEntry);
  }

  // ── Scheduled: contradiction resolution ─────────────────
  const contradictionInterval = setInterval(async () => {
    await runWithRetry("contradiction_sweep", async () => {
      await withTransaction(async (client) => {
        await safeResolveContradictions(client, env.BATCH_SIZE);
      });
    }, contradictionSweepLatency);
  }, env.CONTRADICTION_INTERVAL_SEC * 1000);

  // ── Scheduled: stale fact review ────────────────────────
  const staleInterval = setInterval(async () => {
    await runWithRetry("stale_review", async () => {
      await withTransaction(async (client) => {
        await safeReviewStaleFacts(client, env.BATCH_SIZE);
      });
    }, staleSweepLatency);
  }, env.STALE_REVIEW_INTERVAL_SEC * 1000);

  // ── Run once on startup ─────────────────────────────────
  try {
    await withTransaction(async (client) => {
      await safeResolveContradictions(client, env.BATCH_SIZE);
    });
    log.info("initial_contradiction_sweep_done");
  } catch (err) {
    log.warn("initial_contradiction_sweep_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Graceful shutdown ───────────────────────────────────
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info("shutting_down");
    clearInterval(contradictionInterval);
    clearInterval(staleInterval);
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log.info("running", {
    contradiction_interval: `${env.CONTRADICTION_INTERVAL_SEC}s`,
    stale_interval: `${env.STALE_REVIEW_INTERVAL_SEC}s`,
  });
}

main().catch((err) => {
  log.error("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
