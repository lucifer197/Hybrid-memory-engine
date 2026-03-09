import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vectorSearch } from "../repositories/vectorRepo";

/**
 * Step 6.2 — Retrieval latency regression tests.
 *
 * Seeds a moderate-sized dataset and runs repeated queries to
 * measure p95 retrieval latency at the vector-search layer.
 *
 * Gate: p95 latency < 500ms (local DB, single-node).
 *
 * Requires a running Postgres with pgvector.
 * Set DATABASE_URL and DB_TESTS=1 to enable.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

const TENANT = "latency_test_tenant";
const WORKSPACE = "latency_ws";
const SEED_COUNT = 50;        // memories to seed
const QUERY_RUNS = 20;        // number of query iterations
const P95_THRESHOLD_MS = 500; // max acceptable p95 latency

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

describe.skipIf(!RUN_DB_TESTS)("Step 6.2 — Retrieval latency regression", () => {
  const seededMemoryIds: string[] = [];
  const seededChunkIds: string[] = [];

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

    // Seed SEED_COUNT memories with diverse vectors
    for (let i = 0; i < SEED_COUNT; i++) {
      const { rows: [mem] } = await pool.query(
        `INSERT INTO memories (tenant_id, workspace_id, user_id, memory_type, content_raw, status)
         VALUES ($1, $2, 'latency_user', 'episodic', $3, 'active')
         RETURNING memory_id`,
        [TENANT, WORKSPACE, `Latency test memory #${i} with various content about topic ${i}.`]
      );
      seededMemoryIds.push(mem.memory_id);

      const { rows: [chunk] } = await pool.query(
        `INSERT INTO memory_chunks (memory_id, chunk_index, chunk_text)
         VALUES ($1, 0, $2)
         RETURNING chunk_id`,
        [mem.memory_id, `Latency test memory #${i} with various content about topic ${i}.`]
      );
      seededChunkIds.push(chunk.chunk_id);

      const vec = mockVector(1000 + i);
      await pool.query(
        `INSERT INTO chunk_embeddings (chunk_id, tenant_id, workspace_id, embedding)
         VALUES ($1, $2, $3, $4::vector)`,
        [chunk.chunk_id, TENANT, WORKSPACE, JSON.stringify(vec)]
      );
    }
  }, 60_000); // 60s timeout for seeding

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

  it(`p95 vector search latency < ${P95_THRESHOLD_MS}ms over ${QUERY_RUNS} queries`, async () => {
    const latencies: number[] = [];

    for (let i = 0; i < QUERY_RUNS; i++) {
      const queryVec = mockVector(2000 + i); // different query each time

      const start = performance.now();
      await vectorSearch({
        embedding: queryVec,
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        userId: "latency_user",
        limit: 8,
      });
      const elapsed = performance.now() - start;
      latencies.push(elapsed);
    }

    // Compute p95
    latencies.sort((a, b) => a - b);
    const p95Index = Math.ceil(QUERY_RUNS * 0.95) - 1;
    const p95 = latencies[p95Index];

    const avg = latencies.reduce((s, l) => s + l, 0) / latencies.length;
    const min = latencies[0];
    const max = latencies[latencies.length - 1];

    console.log(
      `[latency] ${QUERY_RUNS} queries over ${SEED_COUNT} memories: ` +
        `avg=${avg.toFixed(1)}ms, p95=${p95.toFixed(1)}ms, min=${min.toFixed(1)}ms, max=${max.toFixed(1)}ms`
    );

    expect(
      p95,
      `p95 latency ${p95.toFixed(1)}ms exceeds threshold ${P95_THRESHOLD_MS}ms`
    ).toBeLessThan(P95_THRESHOLD_MS);
  });

  it("returns results within the requested limit", async () => {
    const queryVec = mockVector(2000);

    const results = await vectorSearch({
      embedding: queryVec,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      userId: "latency_user",
      limit: 5,
    });

    expect(results.length).toBeLessThanOrEqual(5);
    expect(results.length).toBeGreaterThan(0);
  });
});
