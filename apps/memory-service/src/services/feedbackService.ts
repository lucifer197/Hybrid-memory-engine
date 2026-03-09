import { PoolClient } from "pg";
import { withTransaction } from "../db";
import { factRepo } from "../repositories/factRepo";
import { feedbackRepo } from "../repositories/feedbackRepo";
import { contradictionRepo } from "../repositories/contradictionRepo";
import {
  VERIFY_TRUST_DELTA,
  VERIFY_CONFIDENCE_DELTA,
  REJECT_TRUST_DELTA,
  REJECT_CONFIDENCE_DELTA,
  isFeedbackRateLimited,
  computeTrustScore,
} from "./truthScoring";
import { logger } from "../observability/logger";

const log = logger.child("feedbackService");

// ── Shared types ─────────────────────────────────────────────

interface ScopeParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  fact_id: string;
  reason?: string;
}

function notFound(): never {
  const err = new Error("Fact not found") as any;
  err.statusCode = 404;
  err.errorCode = "NOT_FOUND";
  throw err;
}

function rateLimited(): never {
  const err = new Error("Feedback rate-limited — try again in 30 seconds") as any;
  err.statusCode = 429;
  err.errorCode = "RATE_LIMITED";
  throw err;
}

// ── Confirm ──────────────────────────────────────────────────

export interface ConfirmResult {
  fact_id: string;
  trust_score: number;
  confidence: number;
  verification_count: number;
  truth_status: string;
}

export async function confirmFact(params: ScopeParams): Promise<ConfirmResult> {
  return withTransaction(async (client: PoolClient) => {
    const fact = await factRepo.findById(
      client, params.fact_id, params.tenant_id, params.workspace_id, params.user_id
    );
    if (!fact) notFound();

    // Rate-limit check
    const latest = await feedbackRepo.findLatest(
      client, params.tenant_id, params.workspace_id, params.fact_id, "confirm"
    );
    if (isFeedbackRateLimited(latest?.created_at ?? null)) rateLimited();

    // Apply verification boost
    await factRepo.updateTrustAndConfidence(
      client, params.fact_id, VERIFY_TRUST_DELTA, VERIFY_CONFIDENCE_DELTA
    );
    await factRepo.incrementVerification(client, params.fact_id);

    // If contested → restore to active
    if (fact.truth_status === "contested") {
      await factRepo.setTruthStatus(client, params.fact_id, "active");
    }

    // Record feedback
    await feedbackRepo.insert(client, {
      tenantId: params.tenant_id,
      workspaceId: params.workspace_id,
      userId: params.user_id,
      factId: params.fact_id,
      feedbackType: "confirm",
    });

    // Record audit event
    await client.query(
      `INSERT INTO fact_events (fact_id, event_type, delta_confidence, metadata)
       VALUES ($1, 'reinforced', $2, $3)`,
      [params.fact_id, VERIFY_CONFIDENCE_DELTA, JSON.stringify({ source: "user_confirm" })]
    );

    const newTrust = computeTrustScore(
      fact.source_type,
      fact.verification_count + 1,
      fact.rejection_count,
      fact.contradiction_count
    );
    const newConfidence = Math.min(fact.confidence + VERIFY_CONFIDENCE_DELTA, 1.0);
    const newTruthStatus = fact.truth_status === "contested" ? "active" : fact.truth_status;

    log.info("fact_confirmed", {
      fact_id: params.fact_id,
      trust: newTrust,
      confidence: newConfidence,
    });

    return {
      fact_id: params.fact_id,
      trust_score: newTrust,
      confidence: newConfidence,
      verification_count: fact.verification_count + 1,
      truth_status: newTruthStatus,
    };
  });
}

// ── Reject ───────────────────────────────────────────────────

export interface RejectResult {
  fact_id: string;
  trust_score: number;
  confidence: number;
  rejection_count: number;
  truth_status: string;
}

export async function rejectFact(params: ScopeParams): Promise<RejectResult> {
  return withTransaction(async (client: PoolClient) => {
    const fact = await factRepo.findById(
      client, params.fact_id, params.tenant_id, params.workspace_id, params.user_id
    );
    if (!fact) notFound();

    // Rate-limit check
    const latest = await feedbackRepo.findLatest(
      client, params.tenant_id, params.workspace_id, params.fact_id, "reject"
    );
    if (isFeedbackRateLimited(latest?.created_at ?? null)) rateLimited();

    // Apply rejection penalty
    await factRepo.updateTrustAndConfidence(
      client, params.fact_id, REJECT_TRUST_DELTA, REJECT_CONFIDENCE_DELTA
    );
    await factRepo.incrementRejection(client, params.fact_id);

    // Mark contested if still active
    if (fact.truth_status === "active") {
      await factRepo.setTruthStatus(client, params.fact_id, "contested");
    }

    // Record feedback
    await feedbackRepo.insert(client, {
      tenantId: params.tenant_id,
      workspaceId: params.workspace_id,
      userId: params.user_id,
      factId: params.fact_id,
      feedbackType: "reject",
      metadata: params.reason ? { reason: params.reason } : undefined,
    });

    // Record audit event
    const auditMeta: Record<string, unknown> = { source: "user_reject" };
    if (params.reason) auditMeta.reason = params.reason;
    await client.query(
      `INSERT INTO fact_events (fact_id, event_type, delta_confidence, metadata)
       VALUES ($1, 'contested', $2, $3)`,
      [params.fact_id, REJECT_CONFIDENCE_DELTA, JSON.stringify(auditMeta)]
    );

    const newTrust = computeTrustScore(
      fact.source_type,
      fact.verification_count,
      fact.rejection_count + 1,
      fact.contradiction_count
    );
    const newConfidence = Math.max(fact.confidence + REJECT_CONFIDENCE_DELTA, 0);
    const newTruthStatus = fact.truth_status === "active" ? "contested" : fact.truth_status;

    log.info("fact_rejected", {
      fact_id: params.fact_id,
      trust: newTrust,
      confidence: newConfidence,
    });

    return {
      fact_id: params.fact_id,
      trust_score: newTrust,
      confidence: newConfidence,
      rejection_count: fact.rejection_count + 1,
      truth_status: newTruthStatus,
    };
  });
}

// ── Correct ──────────────────────────────────────────────────

export interface CorrectParams extends ScopeParams {
  new_value_text: string;
  new_value_json?: unknown;
}

export interface CorrectResult {
  old_fact_id: string;
  new_fact_id: string;
  trust_score: number;
  confidence: number;
  truth_status: string;
}

export async function correctFact(params: CorrectParams): Promise<CorrectResult> {
  return withTransaction(async (client: PoolClient) => {
    const oldFact = await factRepo.findById(
      client, params.fact_id, params.tenant_id, params.workspace_id, params.user_id
    );
    if (!oldFact) notFound();

    // Create corrected fact (user source → high trust)
    const newFact = await factRepo.insertCorrected(
      client, oldFact, params.new_value_text, params.new_value_json ?? null
    );

    // Supersede old fact
    await factRepo.supersede(client, oldFact.fact_id, newFact.fact_id);
    await factRepo.incrementContradiction(client, oldFact.fact_id);

    // Copy evidence
    await factRepo.copyEvidence(client, oldFact.fact_id, newFact.fact_id);

    // Record contradiction
    await contradictionRepo.insert(client, {
      tenantId: params.tenant_id,
      workspaceId: params.workspace_id,
      factAId: oldFact.fact_id,
      factBId: newFact.fact_id,
      contradictionType: "override",
      resolution: "superseded",
      metadata: { source: "user_correction" },
    });

    // Record feedback
    await feedbackRepo.insert(client, {
      tenantId: params.tenant_id,
      workspaceId: params.workspace_id,
      userId: params.user_id,
      factId: params.fact_id,
      feedbackType: "correct",
      correctionValueText: params.new_value_text,
    });

    // Record audit events
    await client.query(
      `INSERT INTO fact_events (fact_id, event_type, delta_confidence, metadata)
       VALUES ($1, 'superseded', 0, $2)`,
      [oldFact.fact_id, JSON.stringify({ superseded_by: newFact.fact_id, reason: "user_correction" })]
    );
    await client.query(
      `INSERT INTO fact_events (fact_id, event_type, delta_confidence, metadata)
       VALUES ($1, 'created', 0, $2)`,
      [newFact.fact_id, JSON.stringify({ source: "user_correction", supersedes: oldFact.fact_id })]
    );

    log.info("fact_corrected", {
      old_fact_id: oldFact.fact_id,
      new_fact_id: newFact.fact_id,
      subject: oldFact.subject,
      predicate: oldFact.predicate,
    });

    return {
      old_fact_id: oldFact.fact_id,
      new_fact_id: newFact.fact_id,
      trust_score: 0.90, // User corrections start at high trust
      confidence: 0.95,
      truth_status: "active",
    };
  });
}
