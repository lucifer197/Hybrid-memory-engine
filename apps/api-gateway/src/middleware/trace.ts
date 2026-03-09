import { traceMiddleware } from "@hybrid-memory/observability";
import { logger } from "../observability/logger";
import { httpRequestLatency, httpRequestCount } from "../observability/metrics";

export const trace = traceMiddleware({
  service: "api-gateway",
  logger,
  requestLatency: httpRequestLatency,
  requestCount: httpRequestCount,
});
