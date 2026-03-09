import { PoolClient } from "pg";

export interface ContradictionRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  fact_a_id: string;
  fact_b_id: string;
  contradiction_type: string;
  resolution: string;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export const contradictionRepo = {
  async insert(
    client: PoolClient,
    params: {
      tenantId: string;
      workspaceId: string;
      factAId: string;
      factBId: string;
      contradictionType: string;
      resolution?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<ContradictionRow> {
    const { rows } = await client.query<ContradictionRow>(
      `INSERT INTO fact_contradictions
        (tenant_id, workspace_id, fact_a_id, fact_b_id, contradiction_type, resolution, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, workspace_id, fact_a_id, fact_b_id) DO UPDATE
         SET resolution = EXCLUDED.resolution,
             metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        params.tenantId,
        params.workspaceId,
        params.factAId,
        params.factBId,
        params.contradictionType,
        params.resolution ?? "unresolved",
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return rows[0];
  },

  async findByFact(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    factId: string
  ): Promise<ContradictionRow[]> {
    const { rows } = await client.query<ContradictionRow>(
      `SELECT * FROM fact_contradictions
       WHERE tenant_id = $1 AND workspace_id = $2
         AND (fact_a_id = $3 OR fact_b_id = $3)
       ORDER BY created_at DESC`,
      [tenantId, workspaceId, factId]
    );
    return rows;
  },

  async findUnresolved(
    client: PoolClient,
    tenantId: string,
    workspaceId: string
  ): Promise<ContradictionRow[]> {
    const { rows } = await client.query<ContradictionRow>(
      `SELECT * FROM fact_contradictions
       WHERE tenant_id = $1 AND workspace_id = $2 AND resolution = 'unresolved'
       ORDER BY created_at DESC`,
      [tenantId, workspaceId]
    );
    return rows;
  },

  async resolve(
    client: PoolClient,
    contradictionId: string,
    resolution: string
  ): Promise<void> {
    await client.query(
      `UPDATE fact_contradictions SET resolution = $2 WHERE id = $1`,
      [contradictionId, resolution]
    );
  },
};
