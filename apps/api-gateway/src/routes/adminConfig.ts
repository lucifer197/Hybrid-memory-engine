import { Router, Request, Response } from "express";
import { ErrorCode, type ErrorResponse } from "@hybrid-memory/shared-types";
import { getConfig, putConfig } from "../clients/configClient";

export const adminConfigRouter = Router();

// ── GET /v1/admin/config/:tenant_id/:workspace_id ───────────

adminConfigRouter.get(
  "/config/:tenant_id/:workspace_id",
  async (req: Request, res: Response) => {
    const { tenant_id, workspace_id } = req.params;

    if (!tenant_id || !workspace_id) {
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.BadRequest,
          message: "tenant_id and workspace_id are required",
        },
      };
      res.status(400).json(body);
      return;
    }

    try {
      const result = await getConfig(tenant_id, workspace_id);
      res.status(result.status).json(result.body);
    } catch (err) {
      // logged by trace middleware
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.ServiceUnavailable,
          message: "Retrieval service is unavailable",
        },
      };
      res.status(503).json(body);
    }
  }
);

// ── PUT /v1/admin/config/:tenant_id/:workspace_id ───────────

adminConfigRouter.put(
  "/config/:tenant_id/:workspace_id",
  async (req: Request, res: Response) => {
    const { tenant_id, workspace_id } = req.params;

    if (!tenant_id || !workspace_id) {
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.BadRequest,
          message: "tenant_id and workspace_id are required",
        },
      };
      res.status(400).json(body);
      return;
    }

    try {
      const result = await putConfig(tenant_id, workspace_id, req.body);
      res.status(result.status).json(result.body);
    } catch (err) {
      // logged by trace middleware
      const body: ErrorResponse = {
        error: {
          code: ErrorCode.ServiceUnavailable,
          message: "Retrieval service is unavailable",
        },
      };
      res.status(503).json(body);
    }
  }
);
