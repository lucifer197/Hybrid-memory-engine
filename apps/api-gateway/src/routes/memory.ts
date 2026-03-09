import { Router, Request, Response } from "express";
import {
  WriteTurnRequestSchema,
  RetrieveContextRequestSchema,
  ErrorCode,
  type ErrorResponse,
} from "@hybrid-memory/shared-types";
import { getTraceId } from "@hybrid-memory/observability";
import { ZodError } from "zod";
import { writeTurn } from "../clients/memoryServiceClient";
import { retrieveContext } from "../clients/retrievalOrchestratorClient";
import { logger } from "../observability/logger";

export const memoryRouter = Router();

// ── Helpers ──────────────────────────────────────────────────

function zodToErrorResponse(err: ZodError): ErrorResponse {
  return {
    error: {
      code: ErrorCode.BadRequest,
      message: "Validation failed",
      details: err.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    },
  };
}

// ── POST /v1/memory/turn ─────────────────────────────────────

memoryRouter.post("/turn", async (req: Request, res: Response) => {
  const parsed = WriteTurnRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json(zodToErrorResponse(parsed.error));
    return;
  }

  const traceId = getTraceId();

  try {
    const result = await writeTurn(parsed.data, traceId);
    res
      .status(result.status)
      .json(result.body);
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

// ── POST /v1/memory/retrieve ─────────────────────────────────

memoryRouter.post("/retrieve", async (req: Request, res: Response) => {
  const parsed = RetrieveContextRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json(zodToErrorResponse(parsed.error));
    return;
  }

  const traceId = getTraceId();

  try {
    const result = await retrieveContext(parsed.data, traceId);
    res
      .status(result.status)
      .json(result.body);
  } catch (err) {
    logger.error("retrieval_service_unreachable", {
      error: err instanceof Error ? err.message : String(err),
    });
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.ServiceUnavailable,
        message: "Retrieval service is unavailable",
      },
    };
    res.status(503).json(body);
  }
});
