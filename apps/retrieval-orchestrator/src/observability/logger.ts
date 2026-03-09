import { createLogger, type LogContext } from "@hybrid-memory/observability";

export const logger = createLogger("retrieval-orchestrator");

export function createServiceLogger(component: string, ctx?: LogContext) {
  const l = createLogger("retrieval-orchestrator", component);
  return ctx ? l.withContext(ctx) : l;
}
