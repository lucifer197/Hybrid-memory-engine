import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("memory-service");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("memory-service", component);
  return ctx ? l.withContext(ctx) : l;
}
