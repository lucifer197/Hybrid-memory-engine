import { Request, Response, NextFunction } from "express";
import { runWithTrace, type TraceStore } from "./traceContext";
import { randomUUID } from "node:crypto";
import type { Logger } from "./logger";
import type { Histogram, Counter } from "./metrics";

export interface TraceMiddlewareOptions {
  service: string;
  logger: Logger;
  requestLatency?: Histogram;
  requestCount?: Counter;
}

/**
 * Express middleware that:
 * 1. Reads or generates X-Trace-Id
 * 2. Extracts tenant/workspace/user context from headers
 * 3. Sets up AsyncLocalStorage context for the request lifecycle
 * 4. Logs request_start/request_end with timing and context
 * 5. Records request latency/count metrics
 * 6. Sets X-Trace-Id on the response
 */
export function traceMiddleware(
  opts: TraceMiddlewareOptions
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const traceId = (req.headers["x-trace-id"] as string) ?? randomUUID();
    const tenantId = req.headers["x-tenant-id"] as string | undefined;
    const workspaceId = req.headers["x-workspace-id"] as string | undefined;
    const userId = req.headers["x-user-id"] as string | undefined;

    const attributes: Record<string, string> = {};
    if (tenantId) attributes.tenant_id = tenantId;
    if (workspaceId) attributes.workspace_id = workspaceId;
    if (userId) attributes.user_id = userId;

    const store: TraceStore = {
      traceId,
      service: opts.service,
      attributes,
    };

    res.setHeader("X-Trace-Id", traceId);

    runWithTrace(store, () => {
      const start = performance.now();

      opts.logger.info("request_start", {
        method: req.method,
        path: req.path,
      });

      res.on("finish", () => {
        const durationMs = performance.now() - start;
        const route = req.route?.path ?? req.path;

        opts.logger.info("request_end", {
          method: req.method,
          path: route,
          status: res.statusCode,
          duration_ms: parseFloat(durationMs.toFixed(1)),
        });

        opts.requestLatency?.observe(durationMs, {
          method: req.method,
          route,
          status: String(res.statusCode),
        });
        opts.requestCount?.inc({
          method: req.method,
          route,
          status: String(res.statusCode),
        });
      });

      next();
    });
  };
}
