import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("consolidation-worker");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("consolidation-worker", component);
  return ctx ? l.withContext(ctx) : l;
}
