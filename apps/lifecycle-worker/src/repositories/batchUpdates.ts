import { PoolClient } from "pg";
import { getPool } from "../db";

/**
 * Batch-check which memory IDs have been reinforced within the cooldown period.
 * Returns the set of memory IDs that are still in cooldown (should be skipped).
 */
export async function batchCheckCooldowns(
  memoryIds: string[],
  cooldownSec: number
): Promise<Set<string>> {
  if (memoryIds.length === 0) return new Set();

  const pool = getPool();
  const { rows } = await pool.query<{ memory_id: string }>(
    `SELECT memory_id FROM memories
     WHERE memory_id = ANY($1)
       AND last_reinforced_at IS NOT NULL
       AND last_reinforced_at > now() - ($2 || ' seconds')::interval`,
    [memoryIds, cooldownSec]
  );

  return new Set(rows.map((r) => r.memory_id));
}

/**
 * Batch-reinforce multiple memories in a single UPDATE using unnest.
 * Each memory can have a different delta (based on memory_type).
 */
export async function batchReinforce(
  client: PoolClient,
  memories: { memory_id: string; delta: number; cap: number }[]
): Promise<void> {
  if (memories.length === 0) return;

  const ids = memories.map((m) => m.memory_id);
  const deltas = memories.map((m) => m.delta);
  const caps = memories.map((m) => m.cap);

  await client.query(
    `UPDATE memories
     SET stability_score = LEAST(vals.cap, stability_score + vals.delta),
         reinforcement_count = reinforcement_count + 1,
         last_reinforced_at = now(),
         last_accessed_at = now(),
         decay_rate = GREATEST(0.001, decay_rate * 0.9),
         updated_at = now()
     FROM unnest($1::uuid[], $2::float8[], $3::float8[]) AS vals(mid, delta, cap)
     WHERE memory_id = vals.mid`,
    [ids, deltas, caps]
  );
}

/**
 * Batch-insert reinforcement events using multi-row VALUES.
 */
export async function batchInsertReinforceEvents(
  client: PoolClient,
  events: {
    tenant_id: string;
    workspace_id: string;
    memory_id: string;
    delta_stability: number;
    metadata: Record<string, unknown>;
  }[]
): Promise<void> {
  if (events.length === 0) return;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const offset = i * 6;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, 'reinforced', $${offset + 4}, $${offset + 5}::jsonb)`
    );
    values.push(
      events[i].tenant_id,
      events[i].workspace_id,
      events[i].memory_id,
      events[i].delta_stability,
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
