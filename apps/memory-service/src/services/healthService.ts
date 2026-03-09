import { createHealthRoutes, type DependencyCheck } from "@hybrid-memory/observability";
import { getPool } from "../db";

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
      const Redis = (await import("ioredis")).default;
      const url = process.env.REDIS_URL ?? "redis://localhost:6379";
      const r = new Redis(url, { lazyConnect: true, connectTimeout: 2000 });
      try {
        await r.connect();
        await r.ping();
      } finally {
        await r.quit();
      }
    },
  },
];

export const { liveness, readiness } = createHealthRoutes("memory-service", dependencies);
