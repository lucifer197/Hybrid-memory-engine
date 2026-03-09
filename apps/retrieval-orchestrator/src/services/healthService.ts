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
      const { getEnv } = await import("../config/env");
      const r = new Redis(getEnv().REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
      try {
        await r.connect();
        await r.ping();
      } finally {
        await r.quit();
      }
    },
  },
];

export const { liveness, readiness } = createHealthRoutes("retrieval-orchestrator", dependencies);
