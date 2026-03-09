import { PoolClient } from "pg";

/**
 * Batch truth update operations.
 *
 * Replaces per-row UPDATE loops in stale_fact_review with single
 * multi-row statements to reduce round-trips during sweeps.
 */

// ── Batch stale fact downgrade ───────────────────────────────────

interface StaleDowngrade {
  fact_id: string;
  new_trust: number;
  new_confidence: number;
}

/**
 * Batch-update trust_score and confidence for stale facts that remain active.
 * Uses unnest to apply per-fact values in a single UPDATE.
 */
export async function batchDowngradeStaleFacts(
  client: PoolClient,
  downgrades: StaleDowngrade[]
): Promise<void> {
  if (downgrades.length === 0) return;

  const ids = downgrades.map((d) => d.fact_id);
  const trusts = downgrades.map((d) => d.new_trust);
  const confs = downgrades.map((d) => d.new_confidence);

  await client.query(
    `UPDATE semantic_facts f
     SET trust_score = vals.new_trust,
         confidence = vals.new_conf,
         updated_at = now()
     FROM unnest($1::uuid[], $2::float8[], $3::float8[])
       AS vals(fid, new_trust, new_conf)
     WHERE f.fact_id = vals.fid`,
    [ids, trusts, confs]
  );
}

// ── Batch mark unknown ───────────────────────────────────────────

interface UnknownMark {
  fact_id: string;
  new_trust: number;
  new_confidence: number;
}

/**
 * Batch-mark stale facts as "unknown" when trust drops below threshold.
 * Updates truth_status and status in a single UPDATE.
 */
export async function batchMarkUnknown(
  client: PoolClient,
  marks: UnknownMark[]
): Promise<void> {
  if (marks.length === 0) return;

  const ids = marks.map((m) => m.fact_id);
  const trusts = marks.map((m) => m.new_trust);
  const confs = marks.map((m) => m.new_confidence);

  await client.query(
    `UPDATE semantic_facts f
     SET trust_score = vals.new_trust,
         confidence = vals.new_conf,
         truth_status = 'unknown',
         status = 'contested',
         updated_at = now()
     FROM unnest($1::uuid[], $2::float8[], $3::float8[])
       AS vals(fid, new_trust, new_conf)
     WHERE f.fact_id = vals.fid`,
    [ids, trusts, confs]
  );
}

// ── Batch fact event insert ──────────────────────────────────────

interface FactEvent {
  fact_id: string;
  event_type: string;
  delta_confidence: number;
  metadata: Record<string, unknown>;
}

/**
 * Insert multiple fact_events rows in a single multi-row INSERT.
 */
export async function batchInsertFactEvents(
  client: PoolClient,
  events: FactEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const offset = i * 4;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb)`
    );
    values.push(
      events[i].fact_id,
      events[i].event_type,
      events[i].delta_confidence,
      JSON.stringify(events[i].metadata)
    );
  }

  await client.query(
    `INSERT INTO fact_events (fact_id, event_type, delta_confidence, metadata)
     VALUES ${placeholders.join(", ")}`,
    values
  );
}
