import { PoolClient } from "pg";
import { getPool } from "../db";

export interface LifecycleMemoryRow {
  memory_id: string;
  tenant_id: string;
  workspace_id: string;
  memory_type: string;
  stability_score: number;
  decay_rate: number;
  reinforcement_count: number;
  importance: number;
  pinned: boolean;
  last_accessed_at: Date;
  last_reinforced_at: Date | null;
  created_at: Date;
}

export const memoryRepo = {
  /**
   * Find active, non-pinned memories idle longer than `minIdleHours`
   * for decay processing. Returns batch ordered by oldest access first.
   */
  async findDecayable(
    minIdleHours: number,
    stabilityFloor: number,
    limit = 500
  ): Promise<LifecycleMemoryRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<LifecycleMemoryRow>(
      `SELECT memory_id, tenant_id, workspace_id, memory_type,
              stability_score, decay_rate, reinforcement_count, importance,
              pinned, last_accessed_at, last_reinforced_at, created_at
       FROM memories
       WHERE status = 'active'
         AND pinned = false
         AND stability_score > $1
         AND last_accessed_at < now() - ($2 || ' hours')::interval
       ORDER BY last_accessed_at ASC
       LIMIT $3`,
      [stabilityFloor, minIdleHours, limit]
    );
    return rows;
  },

  /**
   * Find active, non-pinned memories eligible for archival:
   * stability below threshold AND idle longer than minIdleDays.
   */
  async findArchivable(
    stabilityThreshold: number,
    minIdleDays: number,
    limit: number
  ): Promise<LifecycleMemoryRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<LifecycleMemoryRow>(
      `SELECT memory_id, tenant_id, workspace_id, memory_type,
              stability_score, decay_rate, reinforcement_count, importance,
              pinned, last_accessed_at, last_reinforced_at, created_at
       FROM memories
       WHERE status = 'active'
         AND pinned = false
         AND stability_score < $1
         AND last_accessed_at < now() - ($2 || ' days')::interval
       ORDER BY stability_score ASC, last_accessed_at ASC
       LIMIT $3`,
      [stabilityThreshold, minIdleDays, limit]
    );
    return rows;
  },

  /**
   * Apply decay: reduce stability_score by decay_rate, clamped to floor.
   * For episodic memories, also slightly increases decay_rate (accelerating
   * decay for noisy episodic content that isn't being reinforced).
   */
  async applyDecay(
    client: PoolClient,
    memoryId: string,
    stabilityFloor: number,
    isEpisodic: boolean
  ): Promise<{ old_stability: number; new_stability: number; new_decay_rate: number }> {
    // Episodic memories get a 2% decay_rate increase per sweep (caps at 0.1)
    const decayRateExpr = isEpisodic
      ? "LEAST(0.1, decay_rate * 1.02)"
      : "decay_rate";

    const { rows } = await client.query<{
      old_stability: number;
      new_stability: number;
      new_decay_rate: number;
    }>(
      `UPDATE memories
       SET stability_score = GREATEST($2, stability_score - decay_rate),
           decay_rate = ${decayRateExpr},
           updated_at = now()
       WHERE memory_id = $1
       RETURNING
         stability_score + decay_rate AS old_stability,
         stability_score AS new_stability,
         decay_rate AS new_decay_rate`,
      [memoryId, stabilityFloor]
    );
    return rows[0];
  },

  /**
   * Reinforce a memory: bump stability, increment count, update timestamps.
   */
  async reinforce(
    client: PoolClient,
    memoryId: string,
    stabilityDelta: number,
    stabilityCap: number
  ): Promise<{ old_stability: number; new_stability: number }> {
    const { rows } = await client.query<{
      old_stability: number;
      new_stability: number;
    }>(
      `UPDATE memories
       SET stability_score = LEAST($3, stability_score + $2),
           reinforcement_count = reinforcement_count + 1,
           last_reinforced_at = now(),
           last_accessed_at = now(),
           decay_rate = GREATEST(0.001, decay_rate * 0.9),
           updated_at = now()
       WHERE memory_id = $1
       RETURNING
         stability_score - $2 AS old_stability,
         stability_score AS new_stability`,
      [memoryId, stabilityDelta, stabilityCap]
    );
    return rows[0];
  },

  /**
   * Mark a memory as archived.
   */
  async archive(client: PoolClient, memoryId: string): Promise<void> {
    await client.query(
      `UPDATE memories
       SET status = 'archived', updated_at = now()
       WHERE memory_id = $1 AND status = 'active'`,
      [memoryId]
    );
  },

  /**
   * Touch last_accessed_at for a batch of memory IDs (fire-and-forget).
   */
  async touchAccessed(memoryIds: string[]): Promise<number> {
    if (memoryIds.length === 0) return 0;
    const pool = getPool();
    const { rowCount } = await pool.query(
      `UPDATE memories
       SET last_accessed_at = now()
       WHERE memory_id = ANY($1) AND status = 'active'`,
      [memoryIds]
    );
    return rowCount ?? 0;
  },

  /**
   * Check if a memory was reinforced within cooldown period.
   */
  async wasRecentlyReinforced(
    memoryId: string,
    cooldownSec: number
  ): Promise<boolean> {
    const pool = getPool();
    const { rows } = await pool.query<{ recent: boolean }>(
      `SELECT (last_reinforced_at IS NOT NULL
              AND last_reinforced_at > now() - ($2 || ' seconds')::interval
             ) AS recent
       FROM memories
       WHERE memory_id = $1`,
      [memoryId, cooldownSec]
    );
    return rows[0]?.recent ?? false;
  },

};
