import { getPool } from "../db";

/**
 * Row shape returned from the retrieval_config table.
 * All fields have safe defaults defined in the migration.
 */
export interface RetrievalConfigRow {
  tenant_id: string;
  workspace_id: string;
  version: number;

  // Fusion weights
  vector_weight: number;
  graph_weight: number;
  recency_weight: number;
  stability_weight: number;
  importance_weight: number;

  // Penalties
  archived_penalty: number;

  // Recency
  recency_half_life_episodic_hours: number;
  recency_half_life_semantic_hours: number;

  // Graph limits
  max_neighbors_per_seed: number;
  max_graph_candidates: number;
  max_hops: number;

  // Retrieval limits
  max_candidates: number;
  max_chunks_per_memory: number;

  // Decay thresholds
  decay_stability_floor: number;
  decay_archive_stability: number;
  decay_archive_min_age_days: number;

  // Consolidation thresholds
  consolidation_similarity_threshold: number;
  consolidation_min_cluster_size: number;
  consolidation_max_age_days: number;

  updated_at: Date;
}

/**
 * Subset of RetrievalConfigRow fields that can be updated via the admin API.
 */
export type RetrievalConfigUpdate = Partial<
  Omit<RetrievalConfigRow, "tenant_id" | "workspace_id" | "version" | "updated_at">
>;

/**
 * Fetch the retrieval config for a tenant+workspace.
 * Returns null if no custom config exists (caller uses defaults).
 */
export async function getRetrievalConfig(
  tenantId: string,
  workspaceId: string
): Promise<RetrievalConfigRow | null> {
  const pool = getPool();
  const { rows } = await pool.query<RetrievalConfigRow>(
    `SELECT * FROM retrieval_config
     WHERE tenant_id = $1 AND workspace_id = $2`,
    [tenantId, workspaceId]
  );
  return rows[0] ?? null;
}

/**
 * Upsert retrieval config for a tenant+workspace.
 * Bumps version on every update for audit/tracking.
 * Returns the updated row.
 */
export async function upsertRetrievalConfig(
  tenantId: string,
  workspaceId: string,
  updates: RetrievalConfigUpdate
): Promise<RetrievalConfigRow> {
  const pool = getPool();

  // Build SET clause dynamically from non-undefined fields
  const setClauses: string[] = [];
  const values: unknown[] = [tenantId, workspaceId];
  let paramIdx = 3;

  const allowedFields: (keyof RetrievalConfigUpdate)[] = [
    "vector_weight", "graph_weight", "recency_weight",
    "stability_weight", "importance_weight", "archived_penalty",
    "recency_half_life_episodic_hours", "recency_half_life_semantic_hours",
    "max_neighbors_per_seed", "max_graph_candidates", "max_hops",
    "max_candidates", "max_chunks_per_memory",
    "decay_stability_floor", "decay_archive_stability", "decay_archive_min_age_days",
    "consolidation_similarity_threshold", "consolidation_min_cluster_size",
    "consolidation_max_age_days",
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClauses.push(`${field} = $${paramIdx}`);
      values.push(updates[field]);
      paramIdx++;
    }
  }

  // Build the INSERT column/value lists for the same fields
  const insertCols = ["tenant_id", "workspace_id"];
  const insertVals = ["$1", "$2"];
  const conflictSets = [
    "version = retrieval_config.version + 1",
    "updated_at = now()",
  ];

  let insertParamIdx = paramIdx;
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      insertCols.push(field);
      insertVals.push(`$${insertParamIdx}`);
      // Re-use the same param index by mapping to the SET clause value
      // Actually we need to re-push the value since we're building separate parts
      conflictSets.push(`${field} = EXCLUDED.${field}`);
      insertParamIdx++;
    }
  }

  // Simpler approach: INSERT with all update values, ON CONFLICT UPDATE
  // Rebuild cleanly:
  const cols: string[] = ["tenant_id", "workspace_id"];
  const vals: string[] = ["$1", "$2"];
  const onConflictSets: string[] = [
    "version = retrieval_config.version + 1",
    "updated_at = now()",
  ];
  const params: unknown[] = [tenantId, workspaceId];
  let idx = 3;

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      cols.push(field);
      vals.push(`$${idx}`);
      onConflictSets.push(`${field} = EXCLUDED.${field}`);
      params.push(updates[field]);
      idx++;
    }
  }

  const sql = `
    INSERT INTO retrieval_config (${cols.join(", ")})
    VALUES (${vals.join(", ")})
    ON CONFLICT (tenant_id, workspace_id)
    DO UPDATE SET ${onConflictSets.join(", ")}
    RETURNING *
  `;

  const { rows } = await pool.query<RetrievalConfigRow>(sql, params);
  return rows[0];
}
