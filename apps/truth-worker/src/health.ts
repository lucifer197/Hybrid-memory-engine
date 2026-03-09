import { createHealthRoutes, type DependencyCheck } from "@hybrid-memory/observability";
import { getPool } from "./db";

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
];

export const { liveness, readiness } = createHealthRoutes("truth-worker", dependencies);
