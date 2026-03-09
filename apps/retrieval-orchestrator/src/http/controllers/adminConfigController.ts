import { Request, Response } from "express";
import { z } from "zod";
import { ErrorCode, type ErrorResponse } from "@hybrid-memory/shared-types";
import {
  getRetrievalConfig,
  upsertRetrievalConfig,
  type RetrievalConfigUpdate,
} from "../../repositories/configRepo";
import {
  invalidateConfigCache,
  getDefaultRetrievalConfig,
} from "../../config/retrievalConfig";

// ── Validation ──────────────────────────────────────────────

const ConfigUpdateSchema = z
  .object({
    vector_weight: z.number().min(0).max(1).optional(),
    graph_weight: z.number().min(0).max(1).optional(),
    recency_weight: z.number().min(0).max(1).optional(),
    stability_weight: z.number().min(0).max(1).optional(),
    importance_weight: z.number().min(0).max(1).optional(),
    archived_penalty: z.number().min(0).max(1).optional(),
    recency_half_life_episodic_hours: z.number().positive().optional(),
    recency_half_life_semantic_hours: z.number().positive().optional(),
    max_neighbors_per_seed: z.number().int().min(1).max(50).optional(),
    max_graph_candidates: z.number().int().min(1).max(500).optional(),
    max_hops: z.number().int().min(1).max(3).optional(),
    max_candidates: z.number().int().min(1).max(1000).optional(),
    max_chunks_per_memory: z.number().int().min(1).max(10).optional(),
    decay_stability_floor: z.number().min(0).max(1).optional(),
    decay_archive_stability: z.number().min(0).max(1).optional(),
    decay_archive_min_age_days: z.number().int().min(1).optional(),
    consolidation_similarity_threshold: z.number().min(0).max(1).optional(),
    consolidation_min_cluster_size: z.number().int().min(2).optional(),
    consolidation_max_age_days: z.number().int().min(1).optional(),
  })
  .strict();

const TenantParamsSchema = z.object({
  tenant_id: z.string().min(1),
  workspace_id: z.string().min(1),
});

// ── GET /internal/config/:tenant_id/:workspace_id ───────────

export async function getConfigController(
  req: Request,
  res: Response
): Promise<void> {
  const paramsParsed = TenantParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "Invalid tenant_id or workspace_id",
        details: paramsParsed.error.errors,
      },
    };
    res.status(400).json(body);
    return;
  }

  const { tenant_id, workspace_id } = paramsParsed.data;

  try {
    const row = await getRetrievalConfig(tenant_id, workspace_id);

    if (!row) {
      // Return defaults with a flag indicating no custom config exists
      res.status(200).json({
        is_custom: false,
        config: getDefaultRetrievalConfig(),
      });
      return;
    }

    res.status(200).json({
      is_custom: true,
      version: row.version,
      config: row,
    });
  } catch (err: any) {
    console.error("[adminConfig] GET failed:", err);
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.Internal,
        message: err.message ?? "Failed to fetch config",
      },
    };
    res.status(500).json(body);
  }
}

// ── PUT /internal/config/:tenant_id/:workspace_id ───────────

export async function putConfigController(
  req: Request,
  res: Response
): Promise<void> {
  const paramsParsed = TenantParamsSchema.safeParse(req.params);
  if (!paramsParsed.success) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "Invalid tenant_id or workspace_id",
        details: paramsParsed.error.errors,
      },
    };
    res.status(400).json(body);
    return;
  }

  const bodyParsed = ConfigUpdateSchema.safeParse(req.body);
  if (!bodyParsed.success) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "Validation failed",
        details: bodyParsed.error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      },
    };
    res.status(400).json(body);
    return;
  }

  if (Object.keys(bodyParsed.data).length === 0) {
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.BadRequest,
        message: "At least one config field must be provided",
      },
    };
    res.status(400).json(body);
    return;
  }

  const { tenant_id, workspace_id } = paramsParsed.data;
  const updates = bodyParsed.data as RetrievalConfigUpdate;

  try {
    const row = await upsertRetrievalConfig(tenant_id, workspace_id, updates);

    // Invalidate cache so next retrieval picks up the new config
    invalidateConfigCache(tenant_id, workspace_id);

    res.status(200).json({
      version: row.version,
      config: row,
    });
  } catch (err: any) {
    console.error("[adminConfig] PUT failed:", err);
    const body: ErrorResponse = {
      error: {
        code: ErrorCode.Internal,
        message: err.message ?? "Failed to update config",
      },
    };
    res.status(500).json(body);
  }
}
