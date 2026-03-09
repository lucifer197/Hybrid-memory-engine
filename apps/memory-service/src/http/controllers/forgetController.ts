import { Request, Response } from "express";
import {
  ForgetRequestSchema,
  ErrorCode,
  type ErrorResponse,
} from "@hybrid-memory/shared-types";
import { forgetMemories } from "../../services/forgetService";

export async function forgetController(
  req: Request,
  res: Response
): Promise<void> {
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

  try {
    const result = await forgetMemories(parsed.data);
    res.status(200).json(result);
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
