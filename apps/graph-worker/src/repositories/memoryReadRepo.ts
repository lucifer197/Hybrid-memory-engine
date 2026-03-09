import { getPool } from "../db";

export interface MemoryRow {
  memory_id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  session_id: string | null;
  memory_type: string;
  content_raw: string;
  tags: string[];
  created_at: Date;
}

export const memoryReadRepo = {
  async getById(memoryId: string): Promise<MemoryRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<MemoryRow>(
      `SELECT memory_id, tenant_id, workspace_id, user_id, session_id,
              memory_type, content_raw, tags, created_at
       FROM memories WHERE memory_id = $1 AND status = 'active'`,
      [memoryId]
    );
    return rows[0] ?? null;
  },

  /**
   * Find other memories in the same session, ordered by created_at.
   * Excludes the given memory.
   */
  async findBySession(
    tenantId: string,
    workspaceId: string,
    sessionId: string,
    excludeMemoryId: string
  ): Promise<MemoryRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<MemoryRow>(
      `SELECT memory_id, tenant_id, workspace_id, user_id, session_id,
              memory_type, content_raw, tags, created_at
       FROM memories
       WHERE tenant_id = $1 AND workspace_id = $2 AND session_id = $3
         AND memory_id != $4 AND status = 'active'
       ORDER BY created_at ASC`,
      [tenantId, workspaceId, sessionId, excludeMemoryId]
    );
    return rows;
  },

  /**
   * Find the immediately preceding memory in a session by created_at.
   */
  async findPreviousInSession(
    tenantId: string,
    workspaceId: string,
    sessionId: string,
    beforeDate: Date
  ): Promise<MemoryRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<MemoryRow>(
      `SELECT memory_id, tenant_id, workspace_id, user_id, session_id,
              memory_type, content_raw, tags, created_at
       FROM memories
       WHERE tenant_id = $1 AND workspace_id = $2 AND session_id = $3
         AND created_at < $4 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, workspaceId, sessionId, beforeDate]
    );
    return rows[0] ?? null;
  },

  /**
   * Find top-N similar memories by chunk embedding centroid similarity.
   * Uses the average embedding of the given memory's chunks as the query vector.
   */
  async findSimilarByEmbedding(
    tenantId: string,
    workspaceId: string,
    memoryId: string,
    limit: number,
    threshold: number
  ): Promise<{ memory_id: string; similarity: number }[]> {
    const pool = getPool();
    const { rows } = await pool.query<{ memory_id: string; similarity: number }>(
      `WITH my_centroid AS (
         SELECT AVG(ce.embedding) AS centroid
         FROM chunk_embeddings ce
         JOIN memory_chunks mc ON mc.chunk_id = ce.chunk_id
         WHERE mc.memory_id = $1
       )
       SELECT
         mc2.memory_id,
         1 - (ce2.embedding <=> c.centroid) / 2 AS similarity
       FROM my_centroid c,
         chunk_embeddings ce2
         JOIN memory_chunks mc2 ON mc2.chunk_id = ce2.chunk_id
       WHERE ce2.tenant_id = $2
         AND ce2.workspace_id = $3
         AND mc2.memory_id != $1
       ORDER BY ce2.embedding <=> c.centroid
       LIMIT $4`,
      [memoryId, tenantId, workspaceId, limit * 2]
    );
    // Deduplicate by memory_id (keep best chunk per memory), filter by threshold
    const seen = new Map<string, number>();
    for (const r of rows) {
      const existing = seen.get(r.memory_id);
      if (existing === undefined || r.similarity > existing) {
        seen.set(r.memory_id, r.similarity);
      }
    }
    return [...seen.entries()]
      .filter(([, sim]) => sim >= threshold)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([memory_id, similarity]) => ({ memory_id, similarity }));
  },
};
