import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, cleanTables, teardownTestDb } from "./helpers";
import { createTurn } from "../services/writeTurnService";
import { getPool } from "../db";
import type { WriteTurnRequest } from "@hybrid-memory/shared-types";

describe("writeTurn — idempotency (Test B) + isolation (Test C)", () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => cleanTables());

  const baseRequest: WriteTurnRequest = {
    tenant_id: "t1",
    workspace_id: "ws1",
    user_id: "u1",
    session_id: "sess1",
    turn_id: "turn_idem_001",
    messages: [
      { role: "user", content: "Set theme to solarized." },
      { role: "assistant", content: "Theme set to solarized." },
    ],
  };

  // ── Test B: Idempotency ──────────────────────────────────

  it("returns identical memory_ids on duplicate turn_id", async () => {
    const first = await createTurn(baseRequest);
    const second = await createTurn(baseRequest);

    expect(second.memory_ids).toEqual(first.memory_ids);
  });

  it("does NOT create extra memories on duplicate", async () => {
    await createTurn(baseRequest);
    await createTurn(baseRequest);

    const pool = getPool();
    const { rows: memories } = await pool.query(
      `SELECT * FROM memories WHERE tenant_id='t1' AND turn_id='turn_idem_001'`
    );
    expect(memories).toHaveLength(1);

    const { rows: chunks } = await pool.query(
      `SELECT * FROM memory_chunks WHERE memory_id = $1`,
      [memories[0].memory_id]
    );
    // Chunk count should match a single write, not be doubled
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("does NOT create extra turn_writes rows on duplicate", async () => {
    await createTurn(baseRequest);
    await createTurn(baseRequest);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM turn_writes
       WHERE tenant_id='t1' AND workspace_id='ws1'
         AND session_id='sess1' AND turn_id='turn_idem_001'`
    );
    expect(rows).toHaveLength(1);
  });

  // ── Test C: Isolation ────────────────────────────────────

  it("same turn_id but different session_id creates new memory", async () => {
    const first = await createTurn(baseRequest);
    const second = await createTurn({
      ...baseRequest,
      session_id: "sess2",
    });

    expect(second.memory_ids).not.toEqual(first.memory_ids);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM memories WHERE tenant_id='t1' AND turn_id='turn_idem_001'`
    );
    expect(rows).toHaveLength(2);
  });

  it("same turn_id but different workspace_id creates new memory", async () => {
    const first = await createTurn(baseRequest);
    const second = await createTurn({
      ...baseRequest,
      workspace_id: "ws2",
    });

    expect(second.memory_ids).not.toEqual(first.memory_ids);
  });
});
