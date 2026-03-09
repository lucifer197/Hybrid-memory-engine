import type { LifecycleJob } from "@hybrid-memory/shared-types";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("retrieval-orchestrator", "lifecycleProducer");

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_KEY = "lifecycle:jobs";

let redisClient: import("ioredis").default | null = null;

async function getRedis() {
  if (!redisClient) {
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(REDIS_URL);
    redisClient.on("connect", () => {
      log.info("redis_connected", { url: REDIS_URL });
    });
    redisClient.on("error", (err) => {
      log.error("redis_error", { error: err.message });
    });
  }
  return redisClient;
}

/**
 * Enqueue a lifecycle job. Fire-and-forget — retrieval
 * must succeed even if Redis is down.
 */
export async function enqueueLifecycleJob(job: LifecycleJob): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.lpush(QUEUE_KEY, JSON.stringify(job));
  } catch (err) {
    log.warn("enqueue_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function closeLifecycleRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
