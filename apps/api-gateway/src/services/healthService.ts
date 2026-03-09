import { createHealthRoutes } from "@hybrid-memory/observability";

export const { liveness, readiness } = createHealthRoutes("api-gateway", []);
