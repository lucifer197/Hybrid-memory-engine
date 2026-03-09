import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("truth-worker");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("truth-worker", component);
  return ctx ? l.withContext(ctx) : l;
}
