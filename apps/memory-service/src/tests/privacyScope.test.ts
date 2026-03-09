import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 9.8 — Privacy scope security tests.
 *
 * Validates:
 *   - Private-scope memory is only visible to the owning user
 *   - Workspace-scope memory is visible to any user in the same workspace
 *   - Tenant-scope memory is visible to any user in the same tenant
 *   - Private memory does NOT leak to other users via vector search
 *
 * Uses the same buildPrivacyScopeClause logic that retrieval-orchestrator uses.
 * Tests directly against DB queries to verify the WHERE clause enforcement.
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
  "Phase 9.8 — Privacy scope enforcement",
  () => {
    const TENANT = "privacy_test_tenant";
    const WS = "privacy_test_ws";
    const OWNER = "user_owner";
    const OTHER = "user_other";

    const createdMemoryIds: string[] = [];
    const createdChunkIds: string[] = [];

    beforeAll(async () => {
      const pool = getPool();
      const migrationsDir = join(__dirname, "..", "migrations");
      const migrationFiles = [
        "001_init.sql",
        "002_indexes.sql",
        "003_pgvector.sql",
        "004_embeddings.sql",
        "005_graph_tables.sql",
        "006_lifecycle_fields.sql",
        "007_memory_events.sql",
        "008_consolidation_tables.sql",
        "010_forget_tombstones.sql",
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

    async function seedMemoryWithScope(
      userId: string,
      privacyScope: string,
      content: string,
      vectorSeed: number
    ) {
      const pool = getPool();
      const {
        rows: [mem],
      } = await pool.query(
        `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status, privacy_scope)
         VALUES ($1, $2, $3, 'episodic', $4, 'active', $5)
         RETURNING memory_id`,
        [TENANT, WS, userId, content, privacyScope]
      );
      createdMemoryIds.push(mem.memory_id);

      const {
        rows: [chunk],
      } = await pool.query(
        `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
         VALUES ($1, 0, $2)
         RETURNING chunk_id`,
        [mem.memory_id, content]
      );
      createdChunkIds.push(chunk.chunk_id);

      const vec = mockVector(vectorSeed);
      await pool.query(
        `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [chunk.chunk_id, TENANT, WS, JSON.stringify(vec)]
      );

      return { memoryId: mem.memory_id, chunkId: chunk.chunk_id, vec };
    }

    /**
     * Simulates the retrieval query with privacy scope clause,
     * matching the logic in retrieval-orchestrator's vectorRepo.
     */
    async function searchWithPrivacy(
      queryVec: number[],
      userId: string,
      limit = 20
    ) {
      const pool = getPool();
      const { rows } = await pool.query<{
        memory_id: string;
        chunk_text: string;
        distance: number;
        privacy_scope: string;
        user_id: string;
      }>(
        `SELECT
           mc.memory_id,
           mc.chunk_text,
           ce.embedding <=> $1::vector AS distance,
           m.privacy_scope,
           m.user_id
         FROM chunk_embeddings ce
         JOIN memory_chunks mc ON mc.chunk_id = ce.chunk_id
         JOIN memories m ON m.memory_id = mc.memory_id
         WHERE ce.tenant_id = $2
           AND ce.workspace_id = $3
           AND m.status IN ('active', 'archived')
           AND (m.privacy_scope != 'private' OR m.user_id = $4)
         ORDER BY distance
         LIMIT $5`,
        [JSON.stringify(queryVec), TENANT, WS, userId, limit]
      );
      return rows;
    }

    // ── Private scope isolation ──────────────────────────────────

    it("private memory is visible to the owning user", async () => {
      const { memoryId, vec } = await seedMemoryWithScope(
        OWNER,
        "private",
        "Owner private secret data",
        200
      );

      const results = await searchWithPrivacy(vec, OWNER);
      expect(results.some((r) => r.memory_id === memoryId)).toBe(true);
    });

    it("private memory is NOT visible to a different user", async () => {
      const { memoryId, vec } = await seedMemoryWithScope(
        OWNER,
        "private",
        "Owner private hidden from others",
        201
      );

      const results = await searchWithPrivacy(vec, OTHER);
      expect(
        results.some((r) => r.memory_id === memoryId),
        "Private memory must not leak to another user"
      ).toBe(false);
    });

    // ── Workspace scope ──────────────────────────────────────────

    it("workspace-scope memory is visible to any user in the same workspace", async () => {
      const { memoryId, vec } = await seedMemoryWithScope(
        OWNER,
        "workspace",
        "Shared workspace notes",
        202
      );

      // Other user in same workspace can see it
      const results = await searchWithPrivacy(vec, OTHER);
      expect(results.some((r) => r.memory_id === memoryId)).toBe(true);
    });

    // ── Tenant scope ─────────────────────────────────────────────

    it("tenant-scope memory is visible to any user in the same tenant", async () => {
      const { memoryId, vec } = await seedMemoryWithScope(
        OWNER,
        "tenant",
        "Company-wide announcement",
        203
      );

      const results = await searchWithPrivacy(vec, OTHER);
      expect(results.some((r) => r.memory_id === memoryId)).toBe(true);
    });

    // ── Mixed scope ordering ─────────────────────────────────────

    it("other user sees workspace + tenant memories but NOT private ones", async () => {
      const priv = await seedMemoryWithScope(
        OWNER,
        "private",
        "Private memo",
        210
      );
      const ws = await seedMemoryWithScope(
        OWNER,
        "workspace",
        "Workspace memo",
        211
      );
      const ten = await seedMemoryWithScope(
        OWNER,
        "tenant",
        "Tenant memo",
        212
      );

      // Use a vector that's similar to all three (seed 210)
      const results = await searchWithPrivacy(priv.vec, OTHER, 50);

      const ids = results.map((r) => r.memory_id);
      expect(
        ids.includes(priv.memoryId),
        "Private memory must not appear for other user"
      ).toBe(false);
      expect(
        ids.includes(ws.memoryId),
        "Workspace memory should appear for other user"
      ).toBe(true);
      expect(
        ids.includes(ten.memoryId),
        "Tenant memory should appear for other user"
      ).toBe(true);
    });
  }
);
