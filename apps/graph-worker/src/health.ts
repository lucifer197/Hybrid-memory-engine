import type Redis from "ioredis";
import { createHealthRoutes, type DependencyCheck } from "@hybrid-memory/observability";
import { getPool } from "./db";

export function createWorkerHealthRoutes(redis: Redis) {
  const dependencies: DependencyCheck[] = [
    {
      name: "postgres",
      check: async () => {
        const client = await getPool().connect();
        try {
          await client.query("SELECT 1");
        } finally {
          client.release();
        }
      },
    },
    {
      name: "redis",
      check: async () => {
        const result = await redis.ping();
        if (result !== "PONG") throw new Error(`unexpected ping response: ${result}`);
      },
    },
  ];

  return createHealthRoutes("graph-worker", dependencies);
}
