import { PoolClient } from "pg";

export interface SemanticFactRow {
  fact_id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_type: string;
  subject: string;
  predicate: string;
  value_text: string;
  value_json: unknown;
  confidence: number;
  status: string;
  superseded_by: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  last_confirmed_at: Date;
}

export interface UpsertFactParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_type: string;
  subject: string;
  predicate: string;
  value_text: string;
  value_json?: unknown;
  confidence: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export const factRepo = {
  /**
   * Find an active fact matching subject+predicate within a workspace/user scope.
   */
  async findActiveMatch(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    userId: string,
    subject: string,
    predicate: string
  ): Promise<SemanticFactRow | null> {
    const { rows } = await client.query<SemanticFactRow>(
      `SELECT * FROM semantic_facts
       WHERE tenant_id = $1
         AND workspace_id = $2
         AND user_id = $3
         AND subject = $4
         AND predicate = $5
         AND status = 'active'
       LIMIT 1`,
      [tenantId, workspaceId, userId, subject, predicate]
    );
    return rows[0] ?? null;
  },

  /**
   * Find all active facts for a given subject within a workspace/user scope.
   */
  async findBySubject(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    userId: string,
    subject: string
  ): Promise<SemanticFactRow[]> {
    const { rows } = await client.query<SemanticFactRow>(
      `SELECT * FROM semantic_facts
       WHERE tenant_id = $1
         AND workspace_id = $2
         AND user_id = $3
         AND subject = $4
         AND status = 'active'`,
      [tenantId, workspaceId, userId, subject]
    );
    return rows;
  },

  /**
   * Insert a new semantic fact and return its fact_id.
   */
  async insert(client: PoolClient, params: UpsertFactParams): Promise<string> {
    const { rows } = await client.query<{ fact_id: string }>(
      `INSERT INTO semantic_facts
         (tenant_id, workspace_id, user_id, fact_type, subject, predicate,
          value_text, value_json, confidence, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING fact_id`,
      [
        params.tenant_id,
        params.workspace_id,
        params.user_id,
        params.fact_type,
        params.subject,
        params.predicate,
        params.value_text,
        params.value_json ? JSON.stringify(params.value_json) : null,
        params.confidence,
        params.source ?? null,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return rows[0].fact_id;
  },

  /**
   * Adjust confidence on an existing fact and update last_confirmed_at.
   * Accepts positive (reinforce) or negative (penalise) delta, clamped to [0, 1].
   */
  async reinforce(
    client: PoolClient,
    factId: string,
    confidenceDelta: number
  ): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET confidence = GREATEST(0, LEAST(confidence + $2, 1.0)),
           last_confirmed_at = now(),
           updated_at = now()
       WHERE fact_id = $1`,
      [factId, confidenceDelta]
    );
  },

  /**
   * Update the value of an existing fact (belief revision).
   */
  async updateValue(
    client: PoolClient,
    factId: string,
    valueText: string,
    valueJson: unknown | null,
    confidence: number
  ): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET value_text = $2,
           value_json = $3,
           confidence = $4,
           updated_at = now(),
           last_confirmed_at = now()
       WHERE fact_id = $1`,
      [factId, valueText, valueJson ? JSON.stringify(valueJson) : null, confidence]
    );
  },

  /**
   * Supersede a fact: mark it superseded and point to the new fact.
   */
  async supersede(
    client: PoolClient,
    oldFactId: string,
    newFactId: string
  ): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET status = 'superseded',
           superseded_by = $2,
           updated_at = now()
       WHERE fact_id = $1`,
      [oldFactId, newFactId]
    );
  },

  /**
   * Mark a fact as contested.
   */
  async markContested(client: PoolClient, factId: string): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET status = 'contested',
           updated_at = now()
       WHERE fact_id = $1`,
      [factId]
    );
  },
};
