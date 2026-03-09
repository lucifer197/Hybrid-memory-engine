import { Router, Request, Response } from "express";
import {
  ForgetRequestSchema,
  ErrorCode,
  type ErrorResponse,
} from "@hybrid-memory/shared-types";
import { getTraceId } from "@hybrid-memory/observability";
import { forgetMemory } from "../clients/memoryServiceClient";
import { logger } from "../observability/logger";

export const memoryForgetRouter = Router();

memoryForgetRouter.post("/forget", async (req: Request, res: Response) => {
  const parsed = ForgetRequestSchema.safeParse(req.body);

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
    const result = await forgetMemory(parsed.data, traceId);
    res.status(result.status).json(result.body);
  } catch (err) {
    logger.error("memory_service_unreachable", {
      error: err instanceof Error ? err.message : String(err),
    });
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.ServiceUnavailable,
        message: "Memory service is unavailable",
      },
    };
    res.status(503).json(body);
  }
});
