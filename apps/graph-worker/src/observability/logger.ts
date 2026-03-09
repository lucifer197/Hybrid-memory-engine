import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("graph-worker");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("graph-worker", component);
  return ctx ? l.withContext(ctx) : l;
}
