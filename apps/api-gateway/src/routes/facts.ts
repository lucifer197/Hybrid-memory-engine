import { Router, Request, Response } from "express";
import { ErrorCode, type ErrorResponse } from "@hybrid-memory/shared-types";
import { getTraceId } from "@hybrid-memory/observability";
import { listFacts, confirmFact, rejectFact, correctFact } from "../clients/factsClient";
import { logger } from "../observability/logger";

export const factsRouter = Router();

// ── GET /v1/facts ────────────────────────────────────────────

factsRouter.get("/", async (req: Request, res: Response) => {
  const { tenant_id, workspace_id, user_id } = req.query as Record<string, string | undefined>;

  if (!tenant_id || !workspace_id || !user_id) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "tenant_id, workspace_id, and user_id are required query parameters",
      },
    };
    res.status(400).json(body);
    return;
  }

  const traceId = getTraceId();

  try {
    const query: Record<string, string> = { tenant_id, workspace_id, user_id };
    if (req.query.status) query.status = String(req.query.status);
    if (req.query.subject) query.subject = String(req.query.subject);
    if (req.query.limit) query.limit = String(req.query.limit);
    if (req.query.offset) query.offset = String(req.query.offset);

    const result = await listFacts(query, traceId);
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

// ── POST /v1/facts/confirm ───────────────────────────────────

factsRouter.post("/confirm", async (req: Request, res: Response) => {
  const { tenant_id, workspace_id, user_id, fact_id } = req.body;

  if (!tenant_id || !workspace_id || !user_id || !fact_id) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "tenant_id, workspace_id, user_id, and fact_id are required",
      },
    };
    res.status(400).json(body);
    return;
  }

  const traceId = getTraceId();

  try {
    const result = await confirmFact(req.body, traceId);
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

// ── POST /v1/facts/reject ────────────────────────────────────

factsRouter.post("/reject", async (req: Request, res: Response) => {
  const { tenant_id, workspace_id, user_id, fact_id } = req.body;

  if (!tenant_id || !workspace_id || !user_id || !fact_id) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "tenant_id, workspace_id, user_id, and fact_id are required",
      },
    };
    res.status(400).json(body);
    return;
  }

  const traceId = getTraceId();

  try {
    const result = await rejectFact(req.body, traceId);
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

// ── POST /v1/facts/correct ───────────────────────────────────

factsRouter.post("/correct", async (req: Request, res: Response) => {
  const { tenant_id, workspace_id, user_id, fact_id, new_value_text } = req.body;

  if (!tenant_id || !workspace_id || !user_id || !fact_id || !new_value_text) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "tenant_id, workspace_id, user_id, fact_id, and new_value_text are required",
      },
    };
    res.status(400).json(body);
    return;
  }

  const traceId = getTraceId();

  try {
    const result = await correctFact(req.body, traceId);
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
