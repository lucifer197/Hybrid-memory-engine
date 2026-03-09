import { PoolClient } from "pg";

/**
 * Batch lifecycle update operations.
 *
 * Replaces per-row UPDATE loops with single multi-row statements
 * to reduce round-trips and transaction overhead during sweeps.
 */

// ── Batch decay ──────────────────────────────────────────────────

interface DecayTarget {
  memory_id: string;
  is_episodic: boolean;
}

interface DecayResult {
  memory_id: string;
  old_stability: number;
  new_stability: number;
  new_decay_rate: number;
}

/**
 * Apply decay to a batch of memories in a single UPDATE.
 *
 * - Reduces stability_score by decay_rate, clamped to floor.
 * - Episodic memories get a 2% decay_rate increase (capped at 0.1).
 * - Returns old and new values for event logging.
 */
export async function batchApplyDecay(
  client: PoolClient,
  targets: DecayTarget[],
  stabilityFloor: number
): Promise<DecayResult[]> {
  if (targets.length === 0) return [];

  const ids = targets.map((t) => t.memory_id);
  const isEpisodic = targets.map((t) => t.is_episodic);

  const { rows } = await client.query<DecayResult>(
    `UPDATE memories m
     SET stability_score = GREATEST($2, m.stability_score - m.decay_rate),
         decay_rate = CASE
           WHEN vals.is_episodic THEN LEAST(0.1, m.decay_rate * 1.02)
           ELSE m.decay_rate
         END,
         updated_at = now()
     FROM unnest($1::uuid[], $3::boolean[]) AS vals(mid, is_episodic)
     WHERE m.memory_id = vals.mid
     RETURNING
       m.memory_id,
       m.stability_score + m.decay_rate AS old_stability,
       m.stability_score AS new_stability,
       m.decay_rate AS new_decay_rate`,
    [ids, stabilityFloor, isEpisodic]
  );
  return rows;
}

// ── Batch archive ────────────────────────────────────────────────

/**
 * Archive a batch of memories in a single UPDATE.
 * Returns count of rows updated.
 */
export async function batchArchive(
  client: PoolClient,
  memoryIds: string[]
): Promise<number> {
  if (memoryIds.length === 0) return 0;

  const { rowCount } = await client.query(
    `UPDATE memories
     SET status = 'archived', updated_at = now()
     WHERE memory_id = ANY($1) AND status = 'active'`,
    [memoryIds]
  );
  return rowCount ?? 0;
}

// ── Batch event insert ───────────────────────────────────────────

interface LifecycleEvent {
  tenant_id: string;
  workspace_id: string;
  memory_id: string;
  event_type: string;
  delta_stability?: number;
  metadata: Record<string, unknown>;
}

/**
 * Insert multiple memory_events rows in a single multi-row INSERT.
 *
 * Replaces N individual INSERT statements with one parameterized query.
 */
export async function batchInsertEvents(
  client: PoolClient,
  events: LifecycleEvent[]
): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const offset = i * 6;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::jsonb)`
    );
    values.push(
      events[i].tenant_id,
      events[i].workspace_id,
      events[i].memory_id,
      events[i].event_type,
      events[i].delta_stability ?? 0,
      JSON.stringify(events[i].metadata)
    );
  }

  await client.query(
    `INSERT INTO memory_events
       (tenant_id, workspace_id, memory_id, event_type, delta_stability, metadata)
     VALUES ${placeholders.join(", ")}`,
    values
  );
}
