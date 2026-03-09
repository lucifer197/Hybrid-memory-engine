import { PoolClient } from "pg";
import { createLogger } from "@hybrid-memory/observability";
import { factRepo } from "../repositories/factRepo";
import { evidenceRepo } from "../repositories/evidenceRepo";
import { eventRepo } from "../repositories/eventRepo";
import { type ExtractedFact, isExplicitConfirmation, defaultConfidence } from "./factExtractor";
import { detectConflict, type ConflictContext } from "./conflictDetector";
import { getEnv } from "../config/env";

const log = createLogger("consolidation-worker", "beliefRevision");

export interface RevisionResult {
  action: "created" | "reinforced" | "superseded" | "contested" | "skipped";
  factId: string | null;
}

/**
 * Process a single extracted fact against the knowledge base.
 *
 * This is the core belief-revision loop:
 *   1. Look up existing active fact for the same (subject, predicate)
 *   2. Run conflict detection (with recency, confirmation, explicit-override rules)
 *   3. Depending on result: create, reinforce, supersede, or mark contested
 *   4. Always link the source memory as evidence
 *   5. Always write an audit event
 */
export async function reviseFact(
  client: PoolClient,
  extracted: ExtractedFact,
  memoryId: string,
  tenantId: string,
  workspaceId: string,
  userId: string,
  conflictCtx?: ConflictContext
): Promise<RevisionResult> {
  const env = getEnv();

  // Skip low-confidence extractions
  if (extracted.confidence < env.MIN_CONFIDENCE) {
    log.debug("skip_low_confidence", {
      subject: extracted.subject,
      predicate: extracted.predicate,
      confidence: extracted.confidence,
    });
    return { action: "skipped", factId: null };
  }

  // 1. Find existing active fact
  const existing = await factRepo.findActiveMatch(
    client,
    tenantId,
    workspaceId,
    userId,
    extracted.subject,
    extracted.predicate
  );

  // 2. Detect conflict (uses recency, confirmation count, explicit-override rules)
  const conflict = detectConflict(extracted, existing, conflictCtx);

  switch (conflict.kind) {
    // ── No existing fact → create new ──────────────────────
    case "no_conflict": {
      // Use type-specific starting confidence, capped by extraction confidence
      const startingConfidence = Math.min(
        extracted.confidence,
        defaultConfidence(extracted.fact_type)
      );

      const factId = await factRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        user_id: userId,
        fact_type: extracted.fact_type,
        subject: extracted.subject,
        predicate: extracted.predicate,
        value_text: extracted.value_text,
        value_json: extracted.value_json,
        confidence: startingConfidence,
        source: extracted.source,
      });

      await evidenceRepo.link(client, factId, memoryId, 1.0);
      await eventRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        fact_id: factId,
        event_type: "created",
        metadata: { memory_id: memoryId, source: extracted.source },
      });

      log.info("fact_created", {
        fact_id: factId,
        subject: extracted.subject,
        predicate: extracted.predicate,
      });
      return { action: "created", factId };
    }

    // ── Same value → reinforce ─────────────────────────────
    case "reinforcement": {
      const factId = conflict.existingFact.fact_id;

      // Explicit user confirmation ("yes", "correct") gets a larger boost
      const isConfirm = conflictCtx
        ? isExplicitConfirmation(conflictCtx.sourceContent)
        : false;
      const boost = isConfirm ? env.CONFIRM_BOOST : env.REINFORCE_BOOST;

      await factRepo.reinforce(client, factId, boost);
      await evidenceRepo.link(client, factId, memoryId, isConfirm ? 1.0 : 0.8);
      await eventRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        fact_id: factId,
        event_type: "reinforced",
        metadata: {
          memory_id: memoryId,
          boost,
          explicit_confirm: isConfirm,
        },
      });

      log.info("fact_reinforced", {
        fact_id: factId,
        subject: extracted.subject,
        predicate: extracted.predicate,
        boost,
        explicit_confirm: isConfirm,
      });
      return { action: "reinforced", factId };
    }

    // ── Higher confidence override → supersede old fact ────
    case "contradiction": {
      const oldFactId = conflict.existingFact.fact_id;

      // Create new fact
      const newFactId = await factRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        user_id: userId,
        fact_type: extracted.fact_type,
        subject: extracted.subject,
        predicate: extracted.predicate,
        value_text: extracted.value_text,
        value_json: extracted.value_json,
        confidence: extracted.confidence,
        source: extracted.source,
      });

      // Penalise old fact confidence before superseding (-0.10)
      await factRepo.reinforce(client, oldFactId, -env.CONTRADICTION_PENALTY);
      // Supersede old
      await factRepo.supersede(client, oldFactId, newFactId);

      // Evidence + audit
      await evidenceRepo.link(client, newFactId, memoryId, 1.0);
      await eventRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        fact_id: oldFactId,
        event_type: "superseded",
        metadata: { new_fact_id: newFactId, memory_id: memoryId },
      });
      await eventRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        fact_id: newFactId,
        event_type: "created",
        metadata: {
          memory_id: memoryId,
          supersedes: oldFactId,
          source: extracted.source,
        },
      });
      await eventRepo.insertConflict(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        old_fact_id: oldFactId,
        new_fact_id: newFactId,
        conflict_type: "contradiction",
        resolution: "superseded",
      });

      log.info("fact_superseded", {
        old_fact_id: oldFactId,
        new_fact_id: newFactId,
        subject: extracted.subject,
        predicate: extracted.predicate,
      });
      return { action: "superseded", factId: newFactId };
    }

    // ── Close confidence, different values → contested ─────
    case "uncertainty": {
      const contestedFactId = conflict.existingFact.fact_id;

      // Create the new fact as contested too
      const newFactId = await factRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        user_id: userId,
        fact_type: extracted.fact_type,
        subject: extracted.subject,
        predicate: extracted.predicate,
        value_text: extracted.value_text,
        value_json: extracted.value_json,
        confidence: extracted.confidence,
        source: extracted.source,
      });

      // Mark both as contested
      await factRepo.markContested(client, contestedFactId);
      await factRepo.markContested(client, newFactId);

      // Evidence + audit
      await evidenceRepo.link(client, newFactId, memoryId, 1.0);
      await eventRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        fact_id: contestedFactId,
        event_type: "contested",
        metadata: { competing_fact_id: newFactId, memory_id: memoryId },
      });
      await eventRepo.insert(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        fact_id: newFactId,
        event_type: "created",
        metadata: {
          memory_id: memoryId,
          contests: contestedFactId,
          source: extracted.source,
        },
      });
      await eventRepo.insertConflict(client, {
        tenant_id: tenantId,
        workspace_id: workspaceId,
        old_fact_id: contestedFactId,
        new_fact_id: newFactId,
        conflict_type: "uncertainty",
        resolution: "contested",
      });

      log.info("fact_contested", {
        old_fact_id: contestedFactId,
        new_fact_id: newFactId,
        subject: extracted.subject,
        predicate: extracted.predicate,
      });
      return { action: "contested", factId: newFactId };
    }
  }
}
