import { PoolClient } from "pg";

// ── Row types ────────────────────────────────────────────────

export interface FactRow {
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
  source_type: string;
  trust_score: number;
  truth_status: string;
  verification_count: number;
  rejection_count: number;
  contradiction_count: number;
  last_verified_at: Date | null;
  last_rejected_at: Date | null;
  superseded_by: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface FactWithEvidence extends FactRow {
  evidence_memory_ids: string[];
}

const FACT_WITH_EVIDENCE = `
  SELECT f.*,
    COALESCE(
      (SELECT array_agg(fe.memory_id::text) FROM fact_evidence fe WHERE fe.fact_id = f.fact_id),
      '{}'
    ) AS evidence_memory_ids
  FROM semantic_facts f`;

// ── Repository ───────────────────────────────────────────────

export const factRepo = {
  async findById(
    client: PoolClient,
    factId: string,
    tenantId: string,
    workspaceId: string,
    userId: string
  ): Promise<FactWithEvidence | null> {
    const { rows } = await client.query<FactWithEvidence>(
      `${FACT_WITH_EVIDENCE}
       WHERE f.fact_id = $1 AND f.tenant_id = $2 AND f.workspace_id = $3 AND f.user_id = $4`,
      [factId, tenantId, workspaceId, userId]
    );
    return rows[0] ?? null;
  },

  async updateTrustAndConfidence(
    client: PoolClient,
    factId: string,
    trustDelta: number,
    confidenceDelta: number,
    extraSets?: { key: string; value: unknown }[]
  ): Promise<void> {
    const sets = [
      "trust_score = GREATEST(0, LEAST(trust_score + $2, 1.0))",
      "confidence = GREATEST(0, LEAST(confidence + $3, 1.0))",
      "updated_at = now()",
    ];
    const values: unknown[] = [factId, trustDelta, confidenceDelta];
    let idx = 4;

    if (extraSets) {
      for (const s of extraSets) {
        sets.push(`${s.key} = $${idx}`);
        values.push(s.value);
        idx++;
      }
    }

    await client.query(
      `UPDATE semantic_facts SET ${sets.join(", ")} WHERE fact_id = $1`,
      values
    );
  },

  async incrementVerification(client: PoolClient, factId: string): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET verification_count = verification_count + 1,
           last_verified_at = now(),
           updated_at = now()
       WHERE fact_id = $1`,
      [factId]
    );
  },

  async incrementRejection(client: PoolClient, factId: string): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET rejection_count = rejection_count + 1,
           last_rejected_at = now(),
           updated_at = now()
       WHERE fact_id = $1`,
      [factId]
    );
  },

  async incrementContradiction(client: PoolClient, factId: string): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET contradiction_count = contradiction_count + 1,
           updated_at = now()
       WHERE fact_id = $1`,
      [factId]
    );
  },

  async setTruthStatus(
    client: PoolClient,
    factId: string,
    truthStatus: string
  ): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET truth_status = $2, status = $2, updated_at = now()
       WHERE fact_id = $1`,
      [factId, truthStatus]
    );
  },

  async supersede(
    client: PoolClient,
    oldFactId: string,
    newFactId: string
  ): Promise<void> {
    await client.query(
      `UPDATE semantic_facts
       SET status = 'superseded', truth_status = 'superseded',
           superseded_by = $2, updated_at = now()
       WHERE fact_id = $1`,
      [oldFactId, newFactId]
    );
  },

  async insertCorrected(
    client: PoolClient,
    old: FactRow,
    newValueText: string,
    newValueJson: unknown | null
  ): Promise<FactRow> {
    const { rows } = await client.query<FactRow>(
      `INSERT INTO semantic_facts
        (tenant_id, workspace_id, user_id, fact_type, subject, predicate,
         value_text, value_json, confidence, status, source, source_type,
         trust_score, truth_status, last_confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.95, 'active', 'user_correction', 'user',
               0.90, 'active', now())
       RETURNING *`,
      [
        old.tenant_id, old.workspace_id, old.user_id,
        old.fact_type, old.subject, old.predicate,
        newValueText, newValueJson ? JSON.stringify(newValueJson) : null,
      ]
    );
    return rows[0];
  },

  async copyEvidence(
    client: PoolClient,
    fromFactId: string,
    toFactId: string
  ): Promise<void> {
    await client.query(
      `INSERT INTO fact_evidence (fact_id, memory_id, weight)
       SELECT $1, memory_id, weight FROM fact_evidence WHERE fact_id = $2
       ON CONFLICT DO NOTHING`,
      [toFactId, fromFactId]
    );
  },

  async getEvidenceMemoryIds(
    client: PoolClient,
    factId: string
  ): Promise<string[]> {
    const { rows } = await client.query<{ memory_id: string }>(
      `SELECT memory_id::text FROM fact_evidence WHERE fact_id = $1`,
      [factId]
    );
    return rows.map((r) => r.memory_id);
  },
};
