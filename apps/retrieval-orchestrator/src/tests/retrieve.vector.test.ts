import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vectorSearch } from "../repositories/vectorRepo";

/**
 * Step 3 — Test B: Retrieval works (vector similarity)
 * Step 3 — Test C: Tenant isolation
 *
 * Requires a running Postgres with pgvector.
 * Set DATABASE_URL and DB_TESTS=1 to enable.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

// Helper: generate a deterministic unit vector from a seed
function mockVector(seed: number, dim = 1536): number[] {
  const vec: number[] = [];
  let s = seed;
  for (let i = 0; i < dim; i++) {
    s = (s * 1664525 + 1013904223) | 0;
    vec.push(((s >>> 0) / 0xffffffff) * 2 - 1);
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

describe.skipIf(!RUN_DB_TESTS)("Step 3 — Vector retrieval tests", () => {
  let memoryIdA: string;
  let chunkIdA: string;
  let memoryIdB: string;
  let chunkIdB: string;

  beforeAll(async () => {
    const pool = getPool();
    const migrationsDir = join(__dirname, "..", "..", "..", "memory-service", "src", "migrations");
    for (const file of ["001_init.sql", "002_indexes.sql", "003_pgvector.sql", "004_embeddings.sql"]) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
    }

    // Seed data: Tenant A
    const mA = await pool.query(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw)
       VALUES ('tenant_A', 'ws1', 'u1', 'preference', 'User prefers dark mode in all IDEs.')
       RETURNING memory_id`
    );
    memoryIdA = mA.rows[0].memory_id;

    const cA = await pool.query(
      `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
       VALUES ($1, 0, 'User prefers dark mode in all IDEs.')
       RETURNING chunk_id`,
      [memoryIdA]
    );
    chunkIdA = cA.rows[0].chunk_id;

    const vecA = mockVector(42);
    await pool.query(
      `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
       VALUES ($1, 'tenant_A', 'ws1', $2::vector)`,
      [chunkIdA, JSON.stringify(vecA)]
    );

    // Seed data: Tenant B
    const mB = await pool.query(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw)
       VALUES ('tenant_B', 'ws1', 'u2', 'episodic', 'Tenant B has different data.')
       RETURNING memory_id`
    );
    memoryIdB = mB.rows[0].memory_id;

    const cB = await pool.query(
      `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
       VALUES ($1, 0, 'Tenant B has different data.')
       RETURNING chunk_id`,
      [memoryIdB]
    );
    chunkIdB = cB.rows[0].chunk_id;

    const vecB = mockVector(99);
    await pool.query(
      `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
       VALUES ($1, 'tenant_B', 'ws1', $2::vector)`,
      [chunkIdB, JSON.stringify(vecB)]
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM chunk_embeddings WHERE chunk_id = ANY($1)", [[chunkIdA, chunkIdB]]);
    await pool.query("DELETE FROM memory_chunks WHERE chunk_id = ANY($1)", [[chunkIdA, chunkIdB]]);
    await pool.query("DELETE FROM memories WHERE memory_id = ANY($1)", [[memoryIdA, memoryIdB]]);
    await closePool();
  });

  // ── Test B: Retrieval works ──────────────────────────────

  it("returns dark mode memory when querying tenant_A", async () => {
    const queryVec = mockVector(42); // same seed = high similarity

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: "tenant_A",
      workspaceId: "ws1",
      userId: "u1",
      limit: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].chunk_text).toContain("dark mode");
  });

  // ── Test C: Tenant isolation ─────────────────────────────

  it("tenant_B query does NOT return tenant_A memories", async () => {
    const queryVec = mockVector(42);

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: "tenant_B",
      workspaceId: "ws1",
      userId: "u2",
      limit: 5,
    });

    // Should only contain tenant_B data
    for (const r of results) {
      expect(r.chunk_text).not.toContain("dark mode");
    }
  });

  it("tenant_A query does NOT return tenant_B memories", async () => {
    const queryVec = mockVector(99);

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: "tenant_A",
      workspaceId: "ws1",
      userId: "u1",
      limit: 5,
    });

    for (const r of results) {
      expect(r.chunk_text).not.toContain("Tenant B");
    }
  });
});
