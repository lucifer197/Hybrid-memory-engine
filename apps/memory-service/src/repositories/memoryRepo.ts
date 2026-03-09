import { PoolClient } from "pg";
import { MemoryType, PrivacyScope } from "@hybrid-memory/shared-types";

export interface InsertMemoryParams {
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  agent_id?: string;
  session_id?: string;
  turn_id?: string;
  memory_type: MemoryType;
  content_raw: string;
  content_summary?: string;
  privacy_scope: PrivacyScope;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryRow {
  memory_id: string;
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  agent_id: string | null;
  session_id: string | null;
  turn_id: string | null;
  memory_type: string;
  content_raw: string;
  content_summary: string | null;
  privacy_scope: string;
  tags: string[];
  metadata: Record<string, unknown>;
  stability_score: number;
  decay_rate: number;
  reinforcement_count: number;
  status: string;
  created_at: Date;
  updated_at: Date;
  last_accessed_at: Date;
}

export const memoryRepo = {
  async insertMemory(
    client: PoolClient,
    params: InsertMemoryParams
  ): Promise<MemoryRow> {
    const { rows } = await client.query<MemoryRow>(
      `INSERT INTO memories
         (tenant_id, workspace_id, user_id, agent_id, session_id, turn_id,
          memory_type, content_raw, content_summary, privacy_scope, tags, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
       RETURNING *`,
      [
        params.tenant_id,
        params.workspace_id,
        params.user_id,
        params.agent_id ?? null,
        params.session_id ?? null,
        params.turn_id ?? null,
        params.memory_type,
        params.content_raw,
        params.content_summary ?? null,
        params.privacy_scope,
        JSON.stringify(params.tags ?? []),
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    return rows[0];
  },

  async getMemoryById(
    client: PoolClient,
    tenantId: string,
    workspaceId: string,
    memoryId: string
  ): Promise<MemoryRow | null> {
    const { rows } = await client.query<MemoryRow>(
      `SELECT * FROM memories
       WHERE memory_id = $1
         AND tenant_id = $2
         AND workspace_id = $3`,
      [memoryId, tenantId, workspaceId]
    );
    return rows[0] ?? null;
  },
};
