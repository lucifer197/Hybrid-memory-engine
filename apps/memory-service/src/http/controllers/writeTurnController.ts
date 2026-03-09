import { Request, Response } from "express";
import {
  WriteTurnRequestSchema,
  ErrorCode,
  type ErrorResponse,
} from "@hybrid-memory/shared-types";
import { createTurn } from "../../services/writeTurnService";

export async function writeTurnController(
  req: Request,
  res: Response
): Promise<void> {
  const parsed = WriteTurnRequestSchema.safeParse(req.body);

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

  try {
    const result = await createTurn(parsed.data);
    res
      .status(201)
      .header("X-Trace-Id", result.trace_id)
      .json({
        turn_id: result.turn_id,
        memory_ids: result.memory_ids,
        created_at: result.created_at,
        trace_id: result.trace_id,
      });
  } catch (err: any) {
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
}
