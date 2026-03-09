import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { graphExpand } from "../services/graphExpand";

/**
 * Graph expansion regression tests.
 *
 * Validates:
 *   - Graph expansion retrieves linked memories via edges
 *   - Cross-tenant graph isolation
 *   - Seed memories are excluded from graph candidates
 *   - Edge weight ordering is respected
 *
 * Requires a running Postgres.
 * Set DATABASE_URL and DB_TESTS=1 to enable.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

const TENANT = "graph_test_tenant";
const WORKSPACE = "graph_ws";

describe.skipIf(!RUN_DB_TESTS)("Graph expansion regression tests", () => {
  const memoryIds: string[] = [];

  beforeAll(async () => {
    const pool = getPool();

    // Run migrations
    const migrationsDir = join(
      __dirname,
      "..",
      "..",
      "..",
      "memory-service",
      "src",
      "migrations"
    );
    for (const file of [
      "001_init.sql",
      "002_indexes.sql",
      "003_pgvector.sql",
      "004_embeddings.sql",
      "005_graph_tables.sql",
      "006_lifecycle_fields.sql",
      "007_memory_events.sql",
      "008_consolidation_tables.sql",
    ]) {
      const sql = readFileSync(join(migrationsDir, file), "utf-8");
      await pool.query(sql);
    }
  });

  afterAll(() => closePool());

  beforeEach(async () => {
    const pool = getPool();
    // Clean test data
    if (memoryIds.length > 0) {
      await pool.query(
        "DELETE FROM memory_edges WHERE tenant_id = $1 AND workspace_id = $2",
        [TENANT, WORKSPACE]
      );
      await pool.query("DELETE FROM memories WHERE memory_id = ANY($1)", [
        memoryIds,
      ]);
      memoryIds.length = 0;
    }
  });

  async function insertMemory(content: string): Promise<string> {
    const pool = getPool();
    const {
      rows: [{ memory_id }],
    } = await pool.query<{ memory_id: string }>(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw)
       VALUES ($1, $2, 'graph_user', 'episodic', $3)
       RETURNING memory_id`,
      [TENANT, WORKSPACE, content]
    );
    memoryIds.push(memory_id);
    return memory_id;
  }

  async function insertEdge(
    src: string,
    dst: string,
    weight: number,
    edgeType = "shares_entity"
  ): Promise<void> {
    const pool = getPool();
    await pool.query(
      `INSERT INTO memory_edges (tenant_id, workspace_id, src_memory_id, dst_memory_id, edge_type, weight)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [TENANT, WORKSPACE, src, dst, edgeType, weight]
    );
  }

  it("retrieves linked memory via a single hop", async () => {
    const seedId = await insertMemory("Seed: user discussed project Alpha.");
    const linkedId = await insertMemory(
      "Linked: project Alpha architecture decisions."
    );

    await insertEdge(seedId, linkedId, 0.8);

    const candidates = await graphExpand(TENANT, WORKSPACE, [seedId]);

    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const found = candidates.find((c) => c.memory_id === linkedId);
    expect(found).toBeDefined();
    expect(found!.hop_depth).toBe(1);
    expect(found!.graph_score).toBe(0.8);
  });

  it("excludes seed memories from graph candidates", async () => {
    const seedId = await insertMemory("Seed memory for graph test.");
    const linkedId = await insertMemory("Linked neighbor.");

    await insertEdge(seedId, linkedId, 0.9);
    // Also create a reverse edge pointing back to seed
    await insertEdge(linkedId, seedId, 0.7, "temporal");

    const candidates = await graphExpand(TENANT, WORKSPACE, [seedId]);

    // Seed should NOT appear in candidates
    const seedInResults = candidates.find((c) => c.memory_id === seedId);
    expect(seedInResults).toBeUndefined();

    // Linked should appear
    const linkedInResults = candidates.find((c) => c.memory_id === linkedId);
    expect(linkedInResults).toBeDefined();
  });

  it("returns candidates sorted by graph_score descending", async () => {
    const seedId = await insertMemory("Seed for ordering test.");
    const highWeight = await insertMemory("High weight neighbor.");
    const lowWeight = await insertMemory("Low weight neighbor.");

    await insertEdge(seedId, highWeight, 0.9);
    await insertEdge(seedId, lowWeight, 0.3);

    const candidates = await graphExpand(TENANT, WORKSPACE, [seedId]);

    expect(candidates.length).toBe(2);
    expect(candidates[0].memory_id).toBe(highWeight);
    expect(candidates[1].memory_id).toBe(lowWeight);
    expect(candidates[0].graph_score).toBeGreaterThan(
      candidates[1].graph_score
    );
  });

  it("deduplicates neighbors from multiple seeds, keeping best score", async () => {
    const seed1 = await insertMemory("Seed 1.");
    const seed2 = await insertMemory("Seed 2.");
    const shared = await insertMemory("Shared neighbor of both seeds.");

    await insertEdge(seed1, shared, 0.6);
    await insertEdge(seed2, shared, 0.9);

    const candidates = await graphExpand(TENANT, WORKSPACE, [seed1, seed2]);

    const sharedCandidate = candidates.find((c) => c.memory_id === shared);
    expect(sharedCandidate).toBeDefined();
    // Should keep the higher score
    expect(sharedCandidate!.graph_score).toBe(0.9);
  });

  it("returns empty for no edges", async () => {
    const seedId = await insertMemory("Isolated memory with no edges.");
    const candidates = await graphExpand(TENANT, WORKSPACE, [seedId]);
    expect(candidates).toHaveLength(0);
  });

  it("returns empty for empty seed list", async () => {
    const candidates = await graphExpand(TENANT, WORKSPACE, []);
    expect(candidates).toHaveLength(0);
  });

  it("enforces cross-tenant isolation in graph traversal", async () => {
    // Tenant A memories + edge
    const seedA = await insertMemory("Tenant A seed.");
    const linkedA = await insertMemory("Tenant A linked.");
    await insertEdge(seedA, linkedA, 0.9);

    // Tenant B memory + edge (using raw SQL to set different tenant)
    const pool = getPool();
    const {
      rows: [{ memory_id: seedB }],
    } = await pool.query<{ memory_id: string }>(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw)
       VALUES ('other_tenant', $1, 'graph_user', 'episodic', 'Other tenant seed.')
       RETURNING memory_id`,
      [WORKSPACE]
    );
    memoryIds.push(seedB);

    const {
      rows: [{ memory_id: linkedB }],
    } = await pool.query<{ memory_id: string }>(
      `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw)
       VALUES ('other_tenant', $1, 'graph_user', 'episodic', 'Other tenant linked.')
       RETURNING memory_id`,
      [WORKSPACE]
    );
    memoryIds.push(linkedB);

    await pool.query(
      `INSERT INTO memory_edges (tenant_id, workspace_id, src_memory_id, dst_memory_id, edge_type, weight)
       VALUES ('other_tenant', $1, $2, $3, 'shares_entity', 0.95)`,
      [WORKSPACE, seedB, linkedB]
    );

    // Query tenant A — should only see tenant A neighbors
    const candidates = await graphExpand(TENANT, WORKSPACE, [seedA]);
    for (const c of candidates) {
      expect(c.memory_id).not.toBe(linkedB);
    }

    // Query other_tenant — should only see other_tenant neighbors
    const candidatesB = await graphExpand("other_tenant", WORKSPACE, [seedB]);
    for (const c of candidatesB) {
      expect(c.memory_id).not.toBe(linkedA);
    }
  });

  it("respects maxTotalCandidates limit", async () => {
    const seedId = await insertMemory("Seed for limit test.");

    // Create 10 neighbors
    for (let i = 0; i < 10; i++) {
      const neighbor = await insertMemory(`Neighbor ${i}`);
      await insertEdge(seedId, neighbor, 0.5 + i * 0.04);
    }

    const candidates = await graphExpand(TENANT, WORKSPACE, [seedId], {
      maxTotalCandidates: 3,
    });

    expect(candidates.length).toBeLessThanOrEqual(3);
  });
});
