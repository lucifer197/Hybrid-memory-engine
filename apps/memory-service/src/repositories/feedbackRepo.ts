import { PoolClient } from "pg";

export interface FeedbackRow {
  feedback_id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
  feedback_type: string;
  correction_value_text: string | null;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export const feedbackRepo = {
  async insert(
    client: PoolClient,
    params: {
      tenantId: string;
      workspaceId: string;
      userId: string;
      factId: string;
      feedbackType: string;
      correctionValueText?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<FeedbackRow> {
    const { rows } = await client.query<FeedbackRow>(
      `INSERT INTO fact_feedback
        (tenant_id, workspace_id, user_id, fact_id, feedback_type, correction_value_text, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.tenantId,
        params.workspaceId,
        params.userId,
        params.factId,
        params.feedbackType,
        params.correctionValueText ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return rows[0];
  },

  /**
   * Find the most recent feedback of a given type for a fact.
   * Used for rate-limiting (e.g. ignore repeated confirms within 30s).
   */
  async findLatest(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    factId: string,
    feedbackType: string
  ): Promise<FeedbackRow | null> {
    const { rows } = await client.query<FeedbackRow>(
      `SELECT * FROM fact_feedback
       WHERE tenant_id = $1 AND workspace_id = $2
         AND fact_id = $3 AND feedback_type = $4
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, workspaceId, factId, feedbackType]
    );
    return rows[0] ?? null;
  },

  async findByFact(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    factId: string
  ): Promise<FeedbackRow[]> {
    const { rows } = await client.query<FeedbackRow>(
      `SELECT * FROM fact_feedback
       WHERE tenant_id = $1 AND workspace_id = $2 AND fact_id = $3
       ORDER BY created_at DESC`,
      [tenantId, workspaceId, factId]
    );
    return rows;
  },
};
