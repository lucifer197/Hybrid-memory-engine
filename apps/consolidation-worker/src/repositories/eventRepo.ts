import { PoolClient } from "pg";

export type FactEventType =
  | "created"
  | "updated"
  | "reinforced"
  | "superseded"
  | "contested"
  | "merged";

export interface InsertEventParams {
  tenant_id: string;
  workspace_id: string;
  fact_id: string;
  event_type: FactEventType;
  metadata?: Record<string, unknown>;
}

export const eventRepo = {
  /**
   * Record a fact lifecycle event in the audit log.
   */
  async insert(client: PoolClient, params: InsertEventParams): Promise<void> {
    await client.query(
      `INSERT INTO fact_events (tenant_id, workspace_id, fact_id, event_type, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        params.tenant_id,
        params.workspace_id,
        params.fact_id,
        params.event_type,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
  },

  /**
   * Record a conflict between two facts.
   */
  async insertConflict(
    client: PoolClient,
    params: {
      tenant_id: string;
      workspace_id: string;
      old_fact_id: string;
      new_fact_id: string;
      conflict_type: "contradiction" | "override" | "uncertainty";
      resolution: "superseded" | "contested" | "manual_required";
    }
  ): Promise<void> {
    await client.query(
      `INSERT INTO fact_conflicts
         (tenant_id, workspace_id, old_fact_id, new_fact_id, conflict_type, resolution)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.tenant_id,
        params.workspace_id,
        params.old_fact_id,
        params.new_fact_id,
        params.conflict_type,
        params.resolution,
      ]
    );
  },
};
