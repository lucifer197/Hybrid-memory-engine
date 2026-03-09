import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("lifecycle-worker");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("lifecycle-worker", component);
  return ctx ? l.withContext(ctx) : l;
}
