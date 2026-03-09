import { PoolClient } from "pg";

export interface TurnWriteRow {
  id: number;
  tenant_id: string;
  workspace_id: string;
  session_id: string;
  turn_id: string;
  status: "processing" | "complete" | "failed";
  request_hash: string | null;
  memory_ids: string[];
  created_at: Date;
  updated_at: Date;
}

export const turnWriteRepo = {
  async findByKey(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    sessionId: string,
    turnId: string
  ): Promise<TurnWriteRow | null> {
    const { rows } = await client.query<TurnWriteRow>(
      `SELECT * FROM turn_writes
       WHERE tenant_id = $1 AND workspace_id = $2
         AND session_id = $3 AND turn_id = $4`,
      [tenantId, workspaceId, sessionId, turnId]
    );
    return rows[0] ?? null;
  },

  async insertProcessing(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    sessionId: string,
    turnId: string,
    requestHash?: string
  ): Promise<TurnWriteRow> {
    const { rows } = await client.query<TurnWriteRow>(
      `INSERT INTO turn_writes (tenant_id, workspace_id, session_id, turn_id, status, request_hash)
       VALUES ($1, $2, $3, $4, 'processing', $5)
       RETURNING *`,
      [tenantId, workspaceId, sessionId, turnId, requestHash ?? null]
    );
    return rows[0];
  },

  async markComplete(
    client: PoolClient,
    id: number,
    memoryIds: string[]
  ): Promise<void> {
    await client.query(
      `UPDATE turn_writes
       SET status = 'complete', memory_ids = $2::jsonb, updated_at = now()
       WHERE id = $1`,
      [id, JSON.stringify(memoryIds)]
    );
  },

  async markFailed(client: PoolClient, id: number): Promise<void> {
    await client.query(
      `UPDATE turn_writes
       SET status = 'failed', updated_at = now()
       WHERE id = $1`,
      [id]
    );
  },
};
