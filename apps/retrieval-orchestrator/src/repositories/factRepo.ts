import { getPool } from "../db";

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
  // Truth layer fields
  source_type: string;
  trust_score: number;
  truth_status: string;
  verification_count: number;
  rejection_count: number;
  contradiction_count: number;
  last_verified_at: Date | null;
  last_confirmed_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface FactWithEvidence extends FactRow {
  evidence_memory_ids: string[];
}

/**
 * Fetch facts whose subject or value_text match any of the
 * given keywords. Includes truth layer fields for ranking.
 */
export async function findFactsByKeywords(
  tenantId: string,
  workspaceId: string,
  userId: string,
  keywords: string[]
): Promise<FactWithEvidence[]> {
  if (keywords.length === 0) return [];

  const conditions: string[] = [];
  const params: unknown[] = [tenantId, workspaceId, userId];
  let idx = 4;

  for (const kw of keywords) {
    const lower = kw.toLowerCase().trim();
    if (lower.length < 2) continue;
    conditions.push(`(LOWER(f.subject) LIKE $${idx} OR LOWER(f.predicate) LIKE $${idx} OR LOWER(f.value_text) LIKE $${idx})`);
    params.push(`%${lower}%`);
    idx++;
  }

  if (conditions.length === 0) return [];

  const query = `
    SELECT f.*, COALESCE(
      (SELECT array_agg(fe.memory_id::text) FROM fact_evidence fe WHERE fe.fact_id = f.fact_id),
      '{}'
    ) AS evidence_memory_ids
    FROM semantic_facts f
    WHERE f.tenant_id = $1
      AND f.workspace_id = $2
      AND f.user_id = $3
      AND f.status IN ('active', 'contested')
      AND (${conditions.join(" OR ")})
    ORDER BY f.trust_score DESC, f.confidence DESC
    LIMIT 20`;

  const { rows } = await getPool().query<FactWithEvidence>(query, params);
  return rows;
}

/**
 * Fetch facts linked to specific memory IDs via fact_evidence.
 * Includes truth layer fields for ranking.
 */
export async function findFactsByMemoryIds(
  tenantId: string,
  workspaceId: string,
  memoryIds: string[]
): Promise<FactWithEvidence[]> {
  if (memoryIds.length === 0) return [];

  const { rows } = await getPool().query<FactWithEvidence>(
    `SELECT DISTINCT ON (f.fact_id)
       f.*,
       COALESCE(
         (SELECT array_agg(fe2.memory_id::text) FROM fact_evidence fe2 WHERE fe2.fact_id = f.fact_id),
         '{}'
       ) AS evidence_memory_ids
     FROM semantic_facts f
     JOIN fact_evidence fe ON fe.fact_id = f.fact_id
     WHERE f.tenant_id = $1
       AND f.workspace_id = $2
       AND f.status IN ('active', 'contested')
       AND fe.memory_id = ANY($3::uuid[])
     ORDER BY f.fact_id, f.trust_score DESC, f.confidence DESC
     LIMIT 20`,
    [tenantId, workspaceId, memoryIds]
  );
  return rows;
}
