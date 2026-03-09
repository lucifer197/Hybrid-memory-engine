import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vectorSearch } from "../repositories/vectorRepo";
import { MemoryType } from "@hybrid-memory/shared-types";

/**
 * Step 6.2 — Golden-set regression tests for retrieval quality.
 *
 * Seeds a small set of memories with deterministic mock embeddings and
 * validates that retrieval returns expected results.
 *
 * Gates:
 *   - Recall@5 >= 0.80 on the golden queries
 *   - Each expected memory found in top-K for its query
 *
 * Requires a running Postgres with pgvector.
 * Set DATABASE_URL and DB_TESTS=1 to enable.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

const TENANT = "golden_test_tenant";
const WORKSPACE = "golden_ws";

// ── Deterministic vector generator ─────────────────────────────

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

/**
 * Create a vector that is similar to the target (cosine ~0.7-0.9)
 * by blending the target vector with random noise.
 */
function similarVector(targetSeed: number, noiseSeed: number, blend = 0.8, dim = 1536): number[] {
  const target = mockVector(targetSeed, dim);
  const noise = mockVector(noiseSeed, dim);
  const blended = target.map((t, i) => blend * t + (1 - blend) * noise[i]);
  const norm = Math.sqrt(blended.reduce((sum, v) => sum + v * v, 0));
  return blended.map((v) => v / norm);
}

// ── Golden test data ───────────────────────────────────────────

interface GoldenSeed {
  label: string;
  content: string;
  memoryType: string;
  vectorSeed: number;
}

interface GoldenQuery {
  label: string;
  querySeed: number;
  expectedLabels: string[];
  k: number;
  filters?: { memoryTypes?: MemoryType[] };
}

const SEEDS: GoldenSeed[] = [
  { label: "dark_mode",      content: "User prefers dark mode in all IDEs and editors.",       memoryType: "preference", vectorSeed: 100 },
  { label: "python_debug",   content: "Spent 3 hours debugging a Python circular import.",     memoryType: "episodic",   vectorSeed: 200 },
  { label: "list_comp",      content: "Python list comprehensions: [x**2 for x in range(10)]", memoryType: "semantic",  vectorSeed: 300 },
  { label: "typescript",     content: "User strongly prefers TypeScript over JavaScript.",      memoryType: "preference", vectorSeed: 400 },
  { label: "docker_deploy",  content: "Deploy with Docker Compose: build, up -d, logs -f.",    memoryType: "procedural", vectorSeed: 500 },
  { label: "project_alpha",  content: "Project Alpha sprint planning: auth module is priority.", memoryType: "episodic",  vectorSeed: 600 },
  { label: "pasta",          content: "Made pasta carbonara with guanciale instead of bacon.",   memoryType: "episodic",  vectorSeed: 700 },
  { label: "weather",        content: "It has been raining for three days, garden waterlogged.", memoryType: "episodic",  vectorSeed: 800 },
];

const QUERIES: GoldenQuery[] = [
  // Basic semantic recall — query similar to dark_mode
  {
    label: "q_dark_mode",
    querySeed: 100,         // identical vector → exact match
    expectedLabels: ["dark_mode"],
    k: 5,
  },
  // Basic semantic recall — query similar to typescript
  {
    label: "q_typescript",
    querySeed: 400,
    expectedLabels: ["typescript"],
    k: 5,
  },
  // Basic semantic recall — query similar to docker
  {
    label: "q_docker",
    querySeed: 500,
    expectedLabels: ["docker_deploy"],
    k: 5,
  },
  // Basic semantic recall — query similar to python debug
  {
    label: "q_python_debug",
    querySeed: 200,
    expectedLabels: ["python_debug"],
    k: 5,
  },
  // Project alpha recall
  {
    label: "q_project_alpha",
    querySeed: 600,
    expectedLabels: ["project_alpha"],
    k: 5,
  },
  // Type filter — only episodic (should not return semantic list_comp)
  {
    label: "q_episodic_filter",
    querySeed: 300,   // vector matching list_comp — but filtered to episodic
    expectedLabels: [],  // list_comp is semantic, should be filtered out
    k: 5,
    filters: { memoryTypes: [MemoryType.Episodic] },
  },
];

describe.skipIf(!RUN_DB_TESTS)("Step 6.2 — Golden-set retrieval regression", () => {
  // Track seeded IDs for cleanup
  const seededMemoryIds: string[] = [];
  const seededChunkIds: string[] = [];
  const labelToMemoryId = new Map<string, string>();

  beforeAll(async () => {
    const pool = getPool();

    // Run all migrations
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

    // Seed all golden memories
    for (const seed of SEEDS) {
      const { rows: [mem] } = await pool.query(
        `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
         VALUES ($1, $2, 'golden_user', $3, $4, 'active')
         RETURNING memory_id`,
        [TENANT, WORKSPACE, seed.memoryType, seed.content]
      );
      const memoryId: string = mem.memory_id;
      seededMemoryIds.push(memoryId);
      labelToMemoryId.set(seed.label, memoryId);

      const { rows: [chunk] } = await pool.query(
        `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
         VALUES ($1, 0, $2)
         RETURNING chunk_id`,
        [memoryId, seed.content]
      );
      const chunkId: string = chunk.chunk_id;
      seededChunkIds.push(chunkId);

      const vec = mockVector(seed.vectorSeed);
      await pool.query(
        `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [chunkId, TENANT, WORKSPACE, JSON.stringify(vec)]
      );
    }
  });

  afterAll(async () => {
    const pool = getPool();
    if (seededChunkIds.length > 0) {
      await pool.query("DELETE FROM chunk_embeddings WHERE chunk_id = ANY($1)", [seededChunkIds]);
      await pool.query("DELETE FROM memory_chunks WHERE chunk_id = ANY($1)", [seededChunkIds]);
    }
    if (seededMemoryIds.length > 0) {
      await pool.query("DELETE FROM memories WHERE memory_id = ANY($1)", [seededMemoryIds]);
    }
    await closePool();
  });

  // ── Individual query tests ─────────────────────────────────

  for (const query of QUERIES) {
    if (query.expectedLabels.length > 0) {
      it(`finds expected memories for "${query.label}"`, async () => {
        const queryVec = mockVector(query.querySeed);
        const results = await vectorSearch({
          embedding: queryVec,
          tenantId: TENANT,
          workspaceId: WORKSPACE,
          userId: "golden_user",
          limit: query.k,
          memoryTypes: query.filters?.memoryTypes,
        });

        for (const expectedLabel of query.expectedLabels) {
          const expectedId = labelToMemoryId.get(expectedLabel);
          expect(expectedId).toBeDefined();

          const found = results.some((r) => r.memory_id === expectedId);
          expect(
            found,
            `Expected "${expectedLabel}" (${expectedId}) in top-${query.k} results for "${query.label}"`
          ).toBe(true);
        }
      });
    }
  }

  // ── Type filter test ───────────────────────────────────────

  it("type filter excludes non-matching memory types", async () => {
    const queryVec = mockVector(300); // vector for list_comp (semantic)
    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      userId: "golden_user",
      limit: 5,
      memoryTypes: [MemoryType.Episodic],
    });

    // list_comp is semantic — should not appear when filtering to episodic
    const listCompId = labelToMemoryId.get("list_comp");
    const found = results.some((r) => r.memory_id === listCompId);
    expect(found, "Semantic memory should not appear in episodic-only results").toBe(false);
  });

  // ── Aggregate Recall@5 gate ────────────────────────────────

  it("Recall@5 >= 0.80 across all golden queries", async () => {
    const queriesWithExpectations = QUERIES.filter((q) => q.expectedLabels.length > 0);
    let totalExpected = 0;
    let totalFound = 0;

    for (const query of queriesWithExpectations) {
      const queryVec = mockVector(query.querySeed);
      const results = await vectorSearch({
        embedding: queryVec,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        userId: "golden_user",
        limit: query.k,
        memoryTypes: query.filters?.memoryTypes,
      });

      for (const expectedLabel of query.expectedLabels) {
        totalExpected++;
        const expectedId = labelToMemoryId.get(expectedLabel);
        if (expectedId && results.some((r) => r.memory_id === expectedId)) {
          totalFound++;
        }
      }
    }

    const recall = totalExpected > 0 ? totalFound / totalExpected : 0;
    expect(
      recall,
      `Recall@5 is ${recall.toFixed(3)}, expected >= 0.80`
    ).toBeGreaterThanOrEqual(0.80);
  });

  // ── Candidate limit enforcement ────────────────────────────

  it("returns at most K results", async () => {
    const queryVec = mockVector(100);
    const k = 3;

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      userId: "golden_user",
      limit: k,
    });

    expect(results.length).toBeLessThanOrEqual(k);
  });
});
