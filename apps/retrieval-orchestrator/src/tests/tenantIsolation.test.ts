import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { truthRank, type TruthRankInput } from "../services/truthRanker";

/**
 * Phase 9.8 — Tenant isolation & security tests (retrieval-orchestrator).
 *
 * Validates:
 *   - Deleted memory does not appear in vector search results
 *   - Superseded fact does not rank above an active fact
 *
 * Cross-tenant and cross-workspace vector isolation are already tested
 * in retrieval_safety.test.ts. This file covers additional scenarios.
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

describe.skipIf(!RUN_DB_TESTS)(
  "Phase 9.8 — Tenant isolation (retrieval-orchestrator)",
  () => {
    const TENANT = "iso_test_tenant";
    const WS = "iso_test_ws";
    const USER = "iso_test_user";

    const createdMemoryIds: string[] = [];
    const createdChunkIds: string[] = [];

    beforeAll(async () => {
      const pool = getPool();
      const migrationsDir = join(
        __dirname,
        "..",
        "..",
        "..",
        "memory-service",
        "src",
        "migrations"
      );
      const migrationFiles = [
        "001_init.sql",
        "002_indexes.sql",
        "003_pgvector.sql",
        "004_embeddings.sql",
        "005_graph_tables.sql",
        "006_lifecycle_fields.sql",
        "007_memory_events.sql",
        "008_consolidation_tables.sql",
      ];
      for (const file of migrationFiles) {
        const sql = readFileSync(join(migrationsDir, file), "utf-8");
        await pool.query(sql);
      }
    });

    afterAll(async () => {
      const pool = getPool();
      if (createdChunkIds.length > 0) {
        await pool.query(
          "DELETE FROM chunk_embeddings WHERE chunk_id = ANY($1)",
          [createdChunkIds]
        );
        await pool.query(
          "DELETE FROM memory_chunks WHERE chunk_id = ANY($1)",
          [createdChunkIds]
        );
      }
      if (createdMemoryIds.length > 0) {
        await pool.query("DELETE FROM memories WHERE memory_id = ANY($1)", [
          createdMemoryIds,
        ]);
      }
      await closePool();
    });

    // ── Deleted memory exclusion (with embedding still in DB) ──────

    it("deleted memory with embeddings still present is excluded from vector search", async () => {
      const pool = getPool();
      const { vectorSearch } = await import("../repositories/vectorRepo");

      // Insert a deleted memory with valid embeddings
      const {
        rows: [mem],
      } = await pool.query(
        `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
         VALUES ($1, $2, $3, 'episodic', 'This was deleted but embedding remains.', 'deleted')
         RETURNING memory_id`,
        [TENANT, WS, USER]
      );
      createdMemoryIds.push(mem.memory_id);

      const {
        rows: [chunk],
      } = await pool.query(
        `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
         VALUES ($1, 0, 'This was deleted but embedding remains.')
         RETURNING chunk_id`,
        [mem.memory_id]
      );
      createdChunkIds.push(chunk.chunk_id);

      const vec = mockVector(99);
      await pool.query(
        `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [chunk.chunk_id, TENANT, WS, JSON.stringify(vec)]
      );

      const results = await vectorSearch({
        embedding: vec,
        tenantId: TENANT,
        workspaceId: WS,
        userId: USER,
        limit: 10,
      });

      const found = results.find((r) => r.memory_id === mem.memory_id);
      expect(
        found,
        "Deleted memory must not appear in search results"
      ).toBeUndefined();
    });

    it("memory soft-deleted after insertion is excluded from subsequent searches", async () => {
      const pool = getPool();
      const { vectorSearch } = await import("../repositories/vectorRepo");

      // Insert an active memory
      const {
        rows: [mem],
      } = await pool.query(
        `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
         VALUES ($1, $2, $3, 'episodic', 'Will be deleted after insert.', 'active')
         RETURNING memory_id`,
        [TENANT, WS, USER]
      );
      createdMemoryIds.push(mem.memory_id);

      const {
        rows: [chunk],
      } = await pool.query(
        `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
         VALUES ($1, 0, 'Will be deleted after insert.')
         RETURNING chunk_id`,
        [mem.memory_id]
      );
      createdChunkIds.push(chunk.chunk_id);

      const vec = mockVector(100);
      await pool.query(
        `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [chunk.chunk_id, TENANT, WS, JSON.stringify(vec)]
      );

      // Verify it appears while active
      const before = await vectorSearch({
        embedding: vec,
        tenantId: TENANT,
        workspaceId: WS,
        userId: USER,
        limit: 10,
      });
      expect(
        before.some((r) => r.memory_id === mem.memory_id),
        "Active memory should be retrievable"
      ).toBe(true);

      // Soft-delete it
      await pool.query(
        "UPDATE memories SET status = 'deleted' WHERE memory_id = $1",
        [mem.memory_id]
      );

      // Verify it no longer appears
      const after = await vectorSearch({
        embedding: vec,
        tenantId: TENANT,
        workspaceId: WS,
        userId: USER,
        limit: 10,
      });
      expect(
        after.some((r) => r.memory_id === mem.memory_id),
        "Deleted memory must not appear after soft-delete"
      ).toBe(false);
    });
  }
);

// ── Superseded fact ranking (pure unit test — no DB needed) ───────

describe("Phase 9.8 — Superseded fact does not rank above active fact", () => {
  const baseInput: TruthRankInput = {
    relevance: 0.8,
    confidence: 0.7,
    trust_score: 0.7,
    verification_count: 2,
    rejection_count: 0,
    truth_status: "active",
    last_verified_at: new Date(),
  };

  it("superseded fact scores lower than identical active fact", () => {
    const activeScore = truthRank({ ...baseInput, truth_status: "active" });
    const supersededScore = truthRank({
      ...baseInput,
      truth_status: "superseded",
    });

    expect(supersededScore).toBeLessThan(activeScore);
  });

  it("superseded fact with higher relevance still scores below active fact", () => {
    const activeScore = truthRank({ ...baseInput, truth_status: "active" });
    const supersededScore = truthRank({
      ...baseInput,
      truth_status: "superseded",
      relevance: 1.0, // max relevance
      confidence: 1.0, // max confidence
    });

    // The 0.30 superseded multiplier should keep it below a decent active fact
    expect(supersededScore).toBeLessThan(activeScore);
  });

  it("contested fact scores lower than active fact", () => {
    const activeScore = truthRank({ ...baseInput, truth_status: "active" });
    const contestedScore = truthRank({
      ...baseInput,
      truth_status: "contested",
    });

    expect(contestedScore).toBeLessThan(activeScore);
  });

  it("ranking order: active > contested > superseded", () => {
    const active = truthRank({ ...baseInput, truth_status: "active" });
    const contested = truthRank({ ...baseInput, truth_status: "contested" });
    const superseded = truthRank({ ...baseInput, truth_status: "superseded" });

    expect(active).toBeGreaterThan(contested);
    expect(contested).toBeGreaterThan(superseded);
  });
});
