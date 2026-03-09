import { PoolClient } from "pg";

export interface FactEvidenceRow {
  fact_id: string;
  memory_id: string;
  weight: number;
  created_at: Date;
}

export const evidenceRepo = {
  /**
   * Link a memory as evidence for a fact.
   * Uses ON CONFLICT to avoid duplicates — if the link already exists,
   * update the weight to the higher value.
   */
  async link(
    client: PoolClient,
    factId: string,
    memoryId: string,
    weight: number = 1.0
  ): Promise<void> {
    await client.query(
      `INSERT INTO fact_evidence (fact_id, memory_id, weight)
       VALUES ($1, $2, $3)
       ON CONFLICT (fact_id, memory_id)
       DO UPDATE SET weight = GREATEST(fact_evidence.weight, EXCLUDED.weight)`,
      [factId, memoryId, weight]
    );
  },

  /**
   * Find all evidence memories for a given fact.
   */
  async findByFact(
    client: PoolClient,
    factId: string
  ): Promise<FactEvidenceRow[]> {
    const { rows } = await client.query<FactEvidenceRow>(
      `SELECT * FROM fact_evidence WHERE fact_id = $1 ORDER BY weight DESC`,
      [factId]
    );
    return rows;
  },

  /**
   * Find all facts supported by a given memory.
   */
  async findByMemory(
    client: PoolClient,
    memoryId: string
  ): Promise<FactEvidenceRow[]> {
    const { rows } = await client.query<FactEvidenceRow>(
      `SELECT * FROM fact_evidence WHERE memory_id = $1`,
      [memoryId]
    );
    return rows;
  },
};
