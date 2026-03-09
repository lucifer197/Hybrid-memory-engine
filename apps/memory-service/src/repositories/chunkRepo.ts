import { PoolClient } from "pg";

export interface ChunkInput {
  chunk_index: number;
  chunk_text: string;
  token_count?: number;
}

export interface ChunkRow {
  chunk_id: string;
  memory_id: string;
  chunk_index: number;
  chunk_text: string;
  token_count: number | null;
  created_at: Date;
}

export const chunkRepo = {
  /**
   * Bulk-insert chunks for a given memory.
   * Uses a single multi-row INSERT for efficiency.
   */
  async insertChunks(
    client: PoolClient,
    memoryId: string,
    chunks: ChunkInput[]
  ): Promise<ChunkRow[]> {
    if (chunks.length === 0) return [];

    const values: unknown[] = [];
    const placeholders: string[] = [];

    chunks.forEach((c, i) => {
      const offset = i * 4;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`
      );
      values.push(memoryId, c.chunk_index, c.chunk_text, c.token_count ?? null);
    });

    const { rows } = await client.query<ChunkRow>(
      `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text, token_count)
       VALUES ${placeholders.join(", ")}
       RETURNING *`,
      values
    );
    return rows;
  },

  async listChunksByMemoryId(
    client: PoolClient,
    memoryId: string
  ): Promise<ChunkRow[]> {
    const { rows } = await client.query<ChunkRow>(
      `SELECT * FROM memory_chunks
       WHERE memory_id = $1
       ORDER BY chunk_index`,
      [memoryId]
    );
    return rows;
  },
};
