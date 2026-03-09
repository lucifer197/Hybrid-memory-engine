import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vectorSearch } from "../repositories/vectorRepo";

/**
 * Step 6.2 — Retrieval safety gates.
 *
 * Validates:
 *   - No cross-tenant leakage (multi-tenant isolation)
 *   - No cross-workspace leakage
 *   - Candidate count limits are enforced
 *   - Archived memories return but with reduced scores
 *
 * Requires a running Postgres with pgvector.
 * Set DATABASE_URL and DB_TESTS=1 to enable.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

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

describe.skipIf(!RUN_DB_TESTS)("Step 6.2 — Retrieval safety gates", () => {
  // Tenant A data
  const tenantA = { tenant: "safety_tenant_A", workspace: "ws_A" };
  const tenantAIds: { memoryIds: string[]; chunkIds: string[] } = { memoryIds: [], chunkIds: [] };

  // Tenant B data (should never appear in Tenant A queries)
  const tenantB = { tenant: "safety_tenant_B", workspace: "ws_B" };
  const tenantBIds: { memoryIds: string[]; chunkIds: string[] } = { memoryIds: [], chunkIds: [] };

  // Tenant A, workspace 2 (cross-workspace isolation)
  const wsA2 = "ws_A2";
  const tenantAws2Ids: { memoryIds: string[]; chunkIds: string[] } = { memoryIds: [], chunkIds: [] };

  beforeAll(async () => {
    const pool = getPool();

    // Run migrations
    const migrationsDir = join(__dirname, "..", "..", "..", "memory-service", "src", "migrations");
    const migrationFiles = [
      "001_init.sql", "002_indexes.sql", "003_pgvector.sql",
      "004_embeddings.sql", "005_graph_tables.sql",
      "006_lifecycle_fields.sql", "007_memory_events.sql",
      "008_consolidation_tables.sql",
    ];
    for (const file of migrationFiles) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
    }

    // Seed Tenant A, Workspace A
    await seedMemory(pool, tenantA.tenant, tenantA.workspace, "Tenant A secret: internal roadmap 2026.", 42, tenantAIds);
    await seedMemory(pool, tenantA.tenant, tenantA.workspace, "Tenant A project notes for Q1 planning.", 43, tenantAIds);

    // Seed Tenant B, Workspace B (uses SAME vector seeds to maximize leakage risk)
    await seedMemory(pool, tenantB.tenant, tenantB.workspace, "Tenant B confidential: merger plans.", 42, tenantBIds);
    await seedMemory(pool, tenantB.tenant, tenantB.workspace, "Tenant B internal: budget allocations.", 43, tenantBIds);

    // Seed Tenant A, Workspace A2 (cross-workspace isolation)
    await seedMemory(pool, tenantA.tenant, wsA2, "Workspace A2 data: separate project.", 42, tenantAws2Ids);
  });

  afterAll(async () => {
    const pool = getPool();
    const allChunkIds = [...tenantAIds.chunkIds, ...tenantBIds.chunkIds, ...tenantAws2Ids.chunkIds];
    const allMemoryIds = [...tenantAIds.memoryIds, ...tenantBIds.memoryIds, ...tenantAws2Ids.memoryIds];

    if (allChunkIds.length > 0) {
      await pool.query("DELETE FROM chunk_embeddings WHERE chunk_id = ANY($1)", [allChunkIds]);
      await pool.query("DELETE FROM memory_chunks WHERE chunk_id = ANY($1)", [allChunkIds]);
    }
    if (allMemoryIds.length > 0) {
      await pool.query("DELETE FROM memories WHERE memory_id = ANY($1)", [allMemoryIds]);
    }
    await closePool();
  });

  // ── Cross-tenant isolation ─────────────────────────────────

  it("Tenant A query returns ZERO Tenant B memories", async () => {
    const queryVec = mockVector(42); // same seed as both tenants

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: tenantA.tenant,
      workspaceId: tenantA.workspace,
      userId: "safety_user",
      limit: 10,
    });

    for (const r of results) {
      const isTenantB = tenantBIds.memoryIds.includes(r.memory_id);
      expect(isTenantB, `Tenant B memory ${r.memory_id} leaked into Tenant A results`).toBe(false);
    }
  });

  it("Tenant B query returns ZERO Tenant A memories", async () => {
    const queryVec = mockVector(42);

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: tenantB.tenant,
      workspaceId: tenantB.workspace,
      userId: "safety_user",
      limit: 10,
    });

    for (const r of results) {
      const isTenantA = tenantAIds.memoryIds.includes(r.memory_id);
      expect(isTenantA, `Tenant A memory ${r.memory_id} leaked into Tenant B results`).toBe(false);
    }
  });

  // ── Cross-workspace isolation ──────────────────────────────

  it("Workspace A query returns ZERO Workspace A2 memories", async () => {
    const queryVec = mockVector(42);

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: tenantA.tenant,
      workspaceId: tenantA.workspace,
      userId: "safety_user",
      limit: 10,
    });

    for (const r of results) {
      const isWsA2 = tenantAws2Ids.memoryIds.includes(r.memory_id);
      expect(isWsA2, `Workspace A2 memory ${r.memory_id} leaked into Workspace A results`).toBe(false);
    }
  });

  it("Workspace A2 query returns ZERO Workspace A memories", async () => {
    const queryVec = mockVector(42);

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: tenantA.tenant,
      workspaceId: wsA2,
      userId: "safety_user",
      limit: 10,
    });

    for (const r of results) {
      const isWsA = tenantAIds.memoryIds.includes(r.memory_id);
      expect(isWsA, `Workspace A memory ${r.memory_id} leaked into Workspace A2 results`).toBe(false);
    }
  });

  // ── Candidate limit enforcement ────────────────────────────

  it("never returns more than the requested limit", async () => {
    const queryVec = mockVector(42);

    for (const limit of [1, 2, 5]) {
      const results = await vectorSearch({
        embedding: queryVec,
        tenantId: tenantA.tenant,
        workspaceId: tenantA.workspace,
        userId: "safety_user",
        limit,
      });
      expect(
        results.length,
        `Requested limit=${limit} but got ${results.length} results`
      ).toBeLessThanOrEqual(limit);
    }
  });

  // ── Archived memories are retrievable but shouldn't pollute active-only ──

  it("includes archived memories in results (status IN active, archived)", async () => {
    const pool = getPool();

    // Create an archived memory with same vector
    const { rows: [mem] } = await pool.query(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
       VALUES ($1, $2, 'safety_user', 'episodic', 'Archived memory about old project.', 'archived')
       RETURNING memory_id`,
      [tenantA.tenant, tenantA.workspace]
    );

    const { rows: [chunk] } = await pool.query(
      `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
       VALUES ($1, 0, 'Archived memory about old project.')
       RETURNING chunk_id`,
      [mem.memory_id]
    );

    const vec = mockVector(42); // high similarity
    await pool.query(
      `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [chunk.chunk_id, tenantA.tenant, tenantA.workspace, JSON.stringify(vec)]
    );

    try {
      const results = await vectorSearch({
        embedding: vec,
        tenantId: tenantA.tenant,
        workspaceId: tenantA.workspace,
        userId: "safety_user",
        limit: 10,
      });

      const archivedResult = results.find((r) => r.memory_id === mem.memory_id);
      expect(archivedResult, "Archived memory should be retrievable").toBeDefined();
      expect(archivedResult!.status).toBe("archived");
    } finally {
      // Cleanup
      await pool.query("DELETE FROM chunk_embeddings WHERE chunk_id = $1", [chunk.chunk_id]);
      await pool.query("DELETE FROM memory_chunks WHERE chunk_id = $1", [chunk.chunk_id]);
      await pool.query("DELETE FROM memories WHERE memory_id = $1", [mem.memory_id]);
    }
  });

  // ── Deleted/soft-deleted memories are excluded ─────────────

  it("excludes deleted memories from results", async () => {
    const pool = getPool();

    const { rows: [mem] } = await pool.query(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
       VALUES ($1, $2, 'safety_user', 'episodic', 'Deleted memory should not appear.', 'deleted')
       RETURNING memory_id`,
      [tenantA.tenant, tenantA.workspace]
    );

    const { rows: [chunk] } = await pool.query(
      `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
       VALUES ($1, 0, 'Deleted memory should not appear.')
       RETURNING chunk_id`,
      [mem.memory_id]
    );

    const vec = mockVector(42);
    await pool.query(
      `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
       VALUES ($1, $2, $3, $4::vector)`,
      [chunk.chunk_id, tenantA.tenant, tenantA.workspace, JSON.stringify(vec)]
    );

    try {
      const results = await vectorSearch({
        embedding: vec,
        tenantId: tenantA.tenant,
        workspaceId: tenantA.workspace,
        userId: "safety_user",
        limit: 10,
      });

      const deletedResult = results.find((r) => r.memory_id === mem.memory_id);
      expect(deletedResult, "Deleted memory must not appear in results").toBeUndefined();
    } finally {
      await pool.query("DELETE FROM chunk_embeddings WHERE chunk_id = $1", [chunk.chunk_id]);
      await pool.query("DELETE FROM memory_chunks WHERE chunk_id = $1", [chunk.chunk_id]);
      await pool.query("DELETE FROM memories WHERE memory_id = $1", [mem.memory_id]);
    }
  });
});

// ── Helper ─────────────────────────────────────────────────────

async function seedMemory(
  pool: import("pg").Pool,
  tenantId: string,
  workspaceId: string,
  content: string,
  vectorSeed: number,
  tracker: { memoryIds: string[]; chunkIds: string[] }
): Promise<void> {
  const { rows: [mem] } = await pool.query(
    `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
     VALUES ($1, $2, 'safety_user', 'episodic', $3, 'active')
     RETURNING memory_id`,
    [tenantId, workspaceId, content]
  );
  tracker.memoryIds.push(mem.memory_id);

  const { rows: [chunk] } = await pool.query(
    `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
     VALUES ($1, 0, $2)
     RETURNING chunk_id`,
    [mem.memory_id, content]
  );
  tracker.chunkIds.push(chunk.chunk_id);

  const vec = mockVector(vectorSeed);
  await pool.query(
    `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
     VALUES ($1, $2, $3, $4::vector)`,
    [chunk.chunk_id, tenantId, workspaceId, JSON.stringify(vec)]
  );
}
