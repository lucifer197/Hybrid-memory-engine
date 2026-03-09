/**
 * Safe retrieval wrapper — adds an overall timeout and structured
 * error handling around the core retrieveContext pipeline.
 *
 * If the pipeline exceeds RETRIEVAL_TIMEOUT_MS, the request fails fast
 * rather than hanging indefinitely. Individual sub-steps (graph, facts,
 * truth ranking) already have their own fallbacks via fallbacks.ts.
 */

import type { RetrieveContextRequest } from "@hybrid-memory/shared-types";
import {
  createLogger,
  withTimeout,
  TimeoutError,
} from "@hybrid-memory/observability";
import { retrieveContext, type RetrieveResult } from "./retrieveContextService";
import { getEnv } from "../config/env";

const log = createLogger("retrieval-orchestrator", "safeRetrieve");

/**
 * Execute retrieval with an overall timeout guard.
 *
 * The inner retrieveContext already handles partial failures:
 *   - Graph expansion fails → vector-only
 *   - Fact lookup fails     → no facts
 *   - Truth ranking fails   → base ranking
 *
 * This wrapper adds an outer timeout so the gateway never waits forever,
 * and logs structured errors for observability.
 */
export async function safeRetrieveContext(
  req: RetrieveContextRequest,
  traceId: string
): Promise<RetrieveResult> {
  const env = getEnv();

  try {
    return await withTimeout(
      retrieveContext(req, traceId),
      env.RETRIEVAL_TIMEOUT_MS,
      "retrieval_pipeline"
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      log.error("retrieval_timeout", {
        trace_id: traceId,
        timeout_ms: env.RETRIEVAL_TIMEOUT_MS,
        tenant_id: req.tenant_id,
        workspace_id: req.workspace_id,
      });
    } else {
      log.error("retrieval_failed", {
        trace_id: traceId,
        error: err instanceof Error ? err.message : String(err),
        tenant_id: req.tenant_id,
        workspace_id: req.workspace_id,
      });
    }
    throw err;
  }
}
