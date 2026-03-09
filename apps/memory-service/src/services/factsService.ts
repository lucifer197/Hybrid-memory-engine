import type { FactRefDTO } from "@hybrid-memory/shared-types";
import { getPool } from "../db";
import {
  confirmFact as confirmFactFeedback,
  rejectFact as rejectFactFeedback,
  correctFact as correctFactFeedback,
  type ConfirmResult,
  type RejectResult,
  type CorrectResult,
  type CorrectParams,
} from "./feedbackService";

// ── Row types ────────────────────────────────────────────────

interface FactWithEvidence {
  fact_id: string;
  fact_type: string;
  subject: string;
  predicate: string;
  value_text: string;
  value_json: unknown;
  confidence: number;
  status: string;
  trust_score: number;
  truth_status: string;
  source_type: string;
  verification_count: number;
  rejection_count: number;
  contradiction_count: number;
  evidence_memory_ids: string[];
}

// ── List facts ───────────────────────────────────────────────

export interface ListFactsParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  status?: string;
  subject?: string;
  limit?: number;
  offset?: number;
}

export interface ListFactsResult {
  facts: FactRefDTO[];
  total: number;
}

export async function listFacts(params: ListFactsParams): Promise<ListFactsResult> {
  const {
    tenant_id, workspace_id, user_id,
    status, subject,
    limit = 50, offset = 0,
  } = params;

  const conditions = [
    "f.tenant_id = $1",
    "f.workspace_id = $2",
    "f.user_id = $3",
  ];
  const values: unknown[] = [tenant_id, workspace_id, user_id];
  let idx = 4;

  if (status) {
    conditions.push(`f.truth_status = $${idx}`);
    values.push(status);
    idx++;
  }

  if (subject) {
    conditions.push(`LOWER(f.subject) LIKE $${idx}`);
    values.push(`%${subject.toLowerCase()}%`);
    idx++;
  }

  const where = conditions.join(" AND ");

  const countQuery = `SELECT count(*)::int AS total FROM semantic_facts f WHERE ${where}`;
  const dataQuery = `
    SELECT f.fact_id, f.fact_type, f.subject, f.predicate, f.value_text, f.value_json,
           f.confidence, f.status, f.trust_score, f.truth_status, f.source_type,
           f.verification_count, f.rejection_count, f.contradiction_count,
      COALESCE(
        (SELECT array_agg(fe.memory_id::text) FROM fact_evidence fe WHERE fe.fact_id = f.fact_id),
        '{}'
      ) AS evidence_memory_ids
    FROM semantic_facts f
    WHERE ${where}
    ORDER BY f.trust_score DESC, f.updated_at DESC
    LIMIT $${idx} OFFSET $${idx + 1}`;

  const pool = getPool();
  const [countRes, dataRes] = await Promise.all([
    pool.query<{ total: number }>(countQuery, values),
    pool.query<FactWithEvidence>(dataQuery, [...values, limit, offset]),
  ]);

  const facts: FactRefDTO[] = dataRes.rows.map(rowToDTO);

  return { facts, total: countRes.rows[0]?.total ?? 0 };
}

// ── Confirm / Reject / Correct — delegate to feedbackService ─

export { type ConfirmResult, type RejectResult, type CorrectResult };

export interface ConfirmFactParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
}

export async function confirmFact(params: ConfirmFactParams): Promise<ConfirmResult> {
  return confirmFactFeedback(params);
}

export interface RejectFactParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
  reason?: string;
}

export async function rejectFact(params: RejectFactParams): Promise<RejectResult> {
  return rejectFactFeedback(params);
}

export interface CorrectFactParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
  new_value_text: string;
  new_value_json?: unknown;
}

export async function correctFact(params: CorrectFactParams): Promise<CorrectResult> {
  return correctFactFeedback(params as CorrectParams);
}

// ── Helpers ──────────────────────────────────────────────────

function rowToDTO(row: FactWithEvidence): FactRefDTO {
  return {
    fact_id: row.fact_id,
    fact_type: row.fact_type,
    subject: row.subject,
    predicate: row.predicate,
    value_text: row.value_text,
    value_json: row.value_json ?? undefined,
    confidence: row.confidence,
    status: row.truth_status,
    trust_score: row.trust_score,
    score: row.trust_score,
    evidence_memory_ids: Array.isArray(row.evidence_memory_ids)
      ? row.evidence_memory_ids
      : [],
  };
}
