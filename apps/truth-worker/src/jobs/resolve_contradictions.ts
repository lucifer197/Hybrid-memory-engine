import { PoolClient } from "pg";
import { createLogger } from "@hybrid-memory/observability";
import { getEnv } from "../config/env";
import {
  contradictionsDetected,
  contradictionsResolved,
  contradictionsSkipped,
  toolFactsPromoted,
} from "../observability/metrics";

const log = createLogger("truth-worker", "resolve_contradictions");

interface ContradictionRow {
  id: string;
  tenant_id: string;
  workspace_id: string;
  fact_a_id: string;
  fact_b_id: string;
  contradiction_type: string;
  resolution: string;
}

interface FactTruthRow {
  fact_id: string;
  trust_score: number;
  confidence: number;
  source_type: string;
  truth_status: string;
  verification_count: number;
  rejection_count: number;
}

/**
 * Resolve unresolved contradictions where trust_score gap is clear enough.
 *
 * Rules:
 * 1. If trust gap ≥ AUTO_RESOLVE_TRUST_GAP → supersede the lower-trust fact
 * 2. If one fact is tool-sourced and the other is assistant → prefer tool
 * 3. If one has significantly more verifications → prefer it
 * 4. Otherwise skip (leave unresolved for human review)
 */
export async function resolveContradictions(
  client: PoolClient,
  batchSize: number
): Promise<number> {
  const env = getEnv();
  const trustGap = env.AUTO_RESOLVE_TRUST_GAP;

  // Fetch unresolved contradictions
  const { rows: contradictions } = await client.query<ContradictionRow>(
    `SELECT * FROM fact_contradictions
     WHERE resolution = 'unresolved'
     ORDER BY created_at ASC
     LIMIT $1`,
    [batchSize]
  );

  if (contradictions.length === 0) return 0;
  contradictionsDetected.inc(undefined, contradictions.length);

  let resolved = 0;

  for (const c of contradictions) {
    // Fetch both facts
    const { rows: facts } = await client.query<FactTruthRow>(
      `SELECT fact_id, trust_score, confidence, source_type, truth_status,
              verification_count, rejection_count
       FROM semantic_facts
       WHERE fact_id IN ($1, $2)`,
      [c.fact_a_id, c.fact_b_id]
    );

    if (facts.length < 2) {
      // One fact was deleted — auto-resolve
      await markResolved(client, c.id, "superseded");
      contradictionsResolved.inc();
      resolved++;
      continue;
    }

    const factA = facts.find((f) => f.fact_id === c.fact_a_id)!;
    const factB = facts.find((f) => f.fact_id === c.fact_b_id)!;

    // Skip if either is already superseded
    if (factA.truth_status === "superseded" || factB.truth_status === "superseded") {
      await markResolved(client, c.id, "superseded");
      contradictionsResolved.inc();
      resolved++;
      continue;
    }

    // Rule 1: Trust gap
    const gap = Math.abs(factA.trust_score - factB.trust_score);
    if (gap >= trustGap) {
      const [winner, loser] = factA.trust_score >= factB.trust_score
        ? [factA, factB]
        : [factB, factA];
      await supersedeFact(client, loser.fact_id, winner.fact_id);
      await markResolved(client, c.id, "superseded");
      contradictionsResolved.inc();
      resolved++;

      log.info("contradiction_resolved_trust_gap", {
        contradiction_id: c.id,
        winner: winner.fact_id,
        loser: loser.fact_id,
        gap: gap.toFixed(3),
      });
      continue;
    }

    // Rule 2: Tool vs assistant preference
    if (factA.source_type === "tool" && factB.source_type === "assistant") {
      await supersedeFact(client, factB.fact_id, factA.fact_id);
      await markResolved(client, c.id, "superseded");
      contradictionsResolved.inc();
      toolFactsPromoted.inc();
      resolved++;
      continue;
    }
    if (factB.source_type === "tool" && factA.source_type === "assistant") {
      await supersedeFact(client, factA.fact_id, factB.fact_id);
      await markResolved(client, c.id, "superseded");
      contradictionsResolved.inc();
      toolFactsPromoted.inc();
      resolved++;
      continue;
    }

    // Rule 3: Verification count advantage (≥3 more)
    const vDiff = (factA.verification_count - factA.rejection_count) -
                  (factB.verification_count - factB.rejection_count);
    if (Math.abs(vDiff) >= 3) {
      const [winner, loser] = vDiff > 0
        ? [factA, factB]
        : [factB, factA];
      await supersedeFact(client, loser.fact_id, winner.fact_id);
      await markResolved(client, c.id, "superseded");
      contradictionsResolved.inc();
      resolved++;
      continue;
    }

    // No clear winner — mark contested, skip
    if (factA.truth_status !== "contested") {
      await client.query(
        `UPDATE semantic_facts SET truth_status = 'contested', status = 'contested', updated_at = now() WHERE fact_id = $1`,
        [factA.fact_id]
      );
    }
    if (factB.truth_status !== "contested") {
      await client.query(
        `UPDATE semantic_facts SET truth_status = 'contested', status = 'contested', updated_at = now() WHERE fact_id = $1`,
        [factB.fact_id]
      );
    }
    await markResolved(client, c.id, "contested");
    contradictionsSkipped.inc();
  }

  log.info("contradiction_sweep_complete", {
    total: contradictions.length,
    resolved,
    skipped: contradictions.length - resolved,
  });

  return resolved;
}

async function supersedeFact(
  client: PoolClient,
  loserId: string,
  winnerId: string
): Promise<void> {
  await client.query(
    `UPDATE semantic_facts
     SET status = 'superseded', truth_status = 'superseded',
         superseded_by = $2, updated_at = now()
     WHERE fact_id = $1`,
    [loserId, winnerId]
  );
  await client.query(
    `INSERT INTO fact_events (fact_id, event_type, delta_confidence, metadata)
     VALUES ($1, 'superseded', 0, $2)`,
    [loserId, JSON.stringify({ superseded_by: winnerId, source: "truth_worker_auto" })]
  );
}

async function markResolved(
  client: PoolClient,
  contradictionId: string,
  resolution: string
): Promise<void> {
  await client.query(
    `UPDATE fact_contradictions SET resolution = $2 WHERE id = $1`,
    [contradictionId, resolution]
  );
}
