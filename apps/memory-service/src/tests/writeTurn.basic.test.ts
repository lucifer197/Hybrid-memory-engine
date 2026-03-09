import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, cleanTables, teardownTestDb } from "./helpers";
import { createTurn } from "../services/writeTurnService";
import { getPool } from "../db";
import type { WriteTurnRequest } from "@hybrid-memory/shared-types";

describe("writeTurn — basic write (Test A)", () => {
  beforeAll(() => setupTestDb());
  afterAll(() => teardownTestDb());
  beforeEach(() => cleanTables());

  const baseRequest: WriteTurnRequest = {
    tenant_id: "t1",
    workspace_id: "ws1",
    user_id: "u1",
    session_id: "sess1",
    turn_id: "turn_basic_001",
    messages: [
      { role: "user", content: "Remember that I like dark mode." },
      { role: "assistant", content: "Got it, dark mode preference saved." },
    ],
  };

  it("returns 201-equivalent with memory_ids.length >= 1", async () => {
    const result = await createTurn(baseRequest);

    expect(result.turn_id).toBe("turn_basic_001");
    expect(result.memory_ids.length).toBeGreaterThanOrEqual(1);
    expect(result.created_at).toBeDefined();
    expect(result.trace_id).toBeDefined();
  });

  it("creates a turn_writes row with status=complete", async () => {
    await createTurn(baseRequest);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM turn_writes
       WHERE tenant_id=$1 AND workspace_id=$2 AND session_id=$3 AND turn_id=$4`,
      ["t1", "ws1", "sess1", "turn_basic_001"]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("complete");
    expect(rows[0].memory_ids).toHaveLength(1);
  });

  it("inserts a memory row", async () => {
    const result = await createTurn(baseRequest);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM memories WHERE memory_id = $1`,
      [result.memory_ids[0]]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe("t1");
    expect(rows[0].memory_type).toBe("episodic");
    expect(rows[0].content_raw).toContain("dark mode");
  });

  it("creates memory_chunks with count > 0", async () => {
    const result = await createTurn(baseRequest);

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT * FROM memory_chunks WHERE memory_id = $1 ORDER BY chunk_index`,
      [result.memory_ids[0]]
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].chunk_index).toBe(0);
    expect(rows[0].chunk_text.length).toBeGreaterThan(0);
  });

  it("respects memory_hints for memory_type", async () => {
    const result = await createTurn({
      ...baseRequest,
      turn_id: "turn_hint_001",
      memory_hints: ["preference"],
    });

    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT memory_type FROM memories WHERE memory_id = $1`,
      [result.memory_ids[0]]
    );

    expect(rows[0].memory_type).toBe("preference");
  });
});
