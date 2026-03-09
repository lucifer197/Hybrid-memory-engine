import { Request, Response } from "express";
import {
  RetrieveContextRequestSchema,
  ErrorCode,
  type ErrorResponse,
} from "@hybrid-memory/shared-types";
import { getTraceId } from "@hybrid-memory/observability";
import { retrieveContext } from "../../services/retrieveContextService";
import { logAccess } from "../../services/accessLogger";
import { logger } from "../../observability/logger";

export async function retrieveController(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = RetrieveContextRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "Validation failed",
        details: parsed.error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      },
    };
    res.status(400).json(body);
    return;
  }

  const traceId = getTraceId();

  try {
    const result = await retrieveContext(parsed.data, traceId);

    // Fire-and-forget: enqueue access + reinforcement jobs to lifecycle-worker
    const memoryRefs = result.memories.map((m) => ({
      memory_id: m.memory_id,
      memory_type: m.memory_type,
    }));
    logAccess(memoryRefs, parsed.data.tenant_id, parsed.data.workspace_id);

    res
      .status(200)
      .json({
        context_blocks: result.context_blocks,
        memories: result.memories,
        debug_info: result.debug_info,
      });
  } catch (err: any) {
    logger.error("retrieve_failed", {
      error: err.message ?? String(err),
    });
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.Internal,
        message: err.message ?? "Retrieval failed",
      },
    };
    res.status(500).json(body);
  }
}
