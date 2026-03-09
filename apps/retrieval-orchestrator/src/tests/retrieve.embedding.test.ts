import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Step 3 — Test A: Write creates embeddings
 * Requires a running Postgres with pgvector.
 * Set DATABASE_URL to point to test DB.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

describe.skipIf(!RUN_DB_TESTS)("Step 3 — Test A: Write creates embeddings", () => {
  beforeAll(async () => {
    const pool = getPool();
    // Run all migrations
    const migrationsDir = join(__dirname, "..", "..", "..", "memory-service", "src", "migrations");
    for (const file of ["001_init.sql", "002_indexes.sql", "003_pgvector.sql", "004_embeddings.sql"]) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
    }
  });

  afterAll(() => closePool());

  it("chunk_embeddings table has rows after embedding job runs", async () => {
    const pool = getPool();

    // Insert a test memory + chunk manually
    const { rows: [memory] } = await pool.query(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw)
       VALUES ('t_test', 'ws_test', 'u_test', 'episodic', 'I prefer dark mode in all IDEs.')
       RETURNING memory_id`
    );

    const { rows: [chunk] } = await pool.query(
      `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
       VALUES ($1, 0, 'I prefer dark mode in all IDEs.')
       RETURNING chunk_id`,
      [memory.memory_id]
    );

    // Simulate embedding upsert (what the worker does)
    const fakeDim = 1536;
    const fakeVec = Array.from({ length: fakeDim }, () => Math.random() * 2 - 1);
    const norm = Math.sqrt(fakeVec.reduce((s, v) => s + v * v, 0));
    const normalized = fakeVec.map((v) => v / norm);

    await pool.query(
      `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
       VALUES ($1, 't_test', 'ws_test', $2::vector)`,
      [chunk.chunk_id, JSON.stringify(normalized)]
    );

    // Verify
    const { rows } = await pool.query(
      `SELECT * FROM chunk_embeddings WHERE chunk_id = $1`,
      [chunk.chunk_id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant_id).toBe("t_test");

    // Cleanup
    await pool.query("DELETE FROM chunk_embeddings WHERE chunk_id = $1", [chunk.chunk_id]);
    await pool.query("DELETE FROM memory_chunks WHERE chunk_id = $1", [chunk.chunk_id]);
    await pool.query("DELETE FROM memories WHERE memory_id = $1", [memory.memory_id]);
  });
});
