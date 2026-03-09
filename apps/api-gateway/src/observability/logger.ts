import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("api-gateway");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("api-gateway", component);
  return ctx ? l.withContext(ctx) : l;
}
