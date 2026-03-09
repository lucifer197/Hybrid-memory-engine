import { Request, Response } from "express";
import { ErrorCode, type ErrorResponse } from "@hybrid-memory/shared-types";
import {
  listFacts,
  confirmFact,
  rejectFact,
  correctFact,
} from "../../services/factsService";
import { factsConfirmed, factsRejected } from "../../observability/metrics";

// ── Shared error helper ──────────────────────────────────────

function errorResponse(res: Response, err: any): void {
  const statusCode = err.statusCode ?? 500;
  const errorCode = err.errorCode ?? ErrorCode.Internal;
  const body: ErrorResponse = {
    error: {
      code: errorCode,
      message: err.message ?? "An unexpected error occurred",
    },
  };
  res.status(statusCode).json(body);
}

// ── GET /internal/facts ──────────────────────────────────────

export async function listFactsController(
  req: Request,
  res: Response
): Promise<void> {
  const { tenant_id, workspace_id, user_id, status, subject, limit, offset } =
    req.query as Record<string, string | undefined>;

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

  try {
    const result = await listFacts({
      tenant_id,
      workspace_id,
      user_id,
      status,
      subject,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.status(200).json(result);
  } catch (err: any) {
    errorResponse(res, err);
  }
}

// ── POST /internal/facts/confirm ─────────────────────────────

export async function confirmFactController(
  req: Request,
  res: Response
): Promise<void> {
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

  try {
    const result = await confirmFact({ tenant_id, workspace_id, user_id, fact_id });
    factsConfirmed.inc();
    res.status(200).json(result);
  } catch (err: any) {
    errorResponse(res, err);
  }
}

// ── POST /internal/facts/reject ──────────────────────────────

export async function rejectFactController(
  req: Request,
  res: Response
): Promise<void> {
  const { tenant_id, workspace_id, user_id, fact_id, reason } = req.body;

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

  try {
    const result = await rejectFact({ tenant_id, workspace_id, user_id, fact_id, reason });
    factsRejected.inc();
    res.status(200).json(result);
  } catch (err: any) {
    errorResponse(res, err);
  }
}

// ── POST /internal/facts/correct ─────────────────────────────

export async function correctFactController(
  req: Request,
  res: Response
): Promise<void> {
  const { tenant_id, workspace_id, user_id, fact_id, new_value_text, new_value_json } =
    req.body;

  if (!tenant_id || !workspace_id || !user_id || !fact_id || !new_value_text) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message:
          "tenant_id, workspace_id, user_id, fact_id, and new_value_text are required",
      },
    };
    res.status(400).json(body);
    return;
  }

  try {
    const result = await correctFact({
      tenant_id,
      workspace_id,
      user_id,
      fact_id,
      new_value_text,
      new_value_json,
    });
    res.status(200).json(result);
  } catch (err: any) {
    errorResponse(res, err);
  }
}
