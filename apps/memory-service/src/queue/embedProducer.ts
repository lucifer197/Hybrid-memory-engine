import type { EmbedJob } from "@hybrid-memory/shared-types";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("memory-service", "embedProducer");

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const QUEUE_KEY = "embed:jobs";

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
 * Enqueue an embedding job. Fire-and-forget — write_turn
 * must succeed even if Redis is down.
 */
export async function enqueueEmbedJob(job: EmbedJob): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.lpush(QUEUE_KEY, JSON.stringify(job));
  } catch (err) {
    // Log but never fail the write path
    log.warn("enqueue_failed", {
      memory_id: job.memory_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
