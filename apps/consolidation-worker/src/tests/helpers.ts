import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let pool: Pool | null = null;

export function getTestPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgres://hybrid:hybrid@localhost:5432/hybrid_memory",
    });
  }
  return pool;
}

/**
 * Run all migrations so tables exist for tests.
 */
export async function setupTestDb(): Promise<Pool> {
  const p = getTestPool();
  const migrationsDir = join(
    __dirname,
    "..",
    "..",
    "..",
    "memory-service",
    "src",
    "migrations"
  );
  const files = [
    "001_init.sql",
    "002_indexes.sql",
    "003_pgvector.sql",
    "004_embeddings.sql",
    "005_graph_tables.sql",
    "006_lifecycle_fields.sql",
    "007_memory_events.sql",
    "008_consolidation_tables.sql",
    "009_retrieval_config.sql",
    "010_forget_tombstones.sql",
    "011_semantic_facts.sql",
    "012_fact_evidence.sql",
    "013_fact_events.sql",
    "014_fact_conflicts.sql",
    "015_truth_fields.sql",
    "016_fact_feedback.sql",
    "017_fact_contradictions.sql",
    "018_dead_letter_jobs.sql",
  ];
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    await p.query(sql);
  }
  return p;
}

/** Remove test data from consolidation-related tables. */
export async function cleanTables(): Promise<void> {
  const p = getTestPool();
  await p.query(
    "TRUNCATE fact_events, fact_evidence, fact_conflicts, fact_contradictions, semantic_facts, memory_chunks, memories, turn_writes CASCADE"
  );
}

export async function teardownTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Insert a minimal memory row for testing. Returns the memory_id.
 */
export async function insertTestMemory(
  p: Pool,
  overrides: Partial<{
    tenant_id: string;
    workspace_id: string;
    user_id: string;
    content_raw: string;
    memory_type: string;
    tags: string[];
    metadata: Record<string, unknown>;
  }> = {}
): Promise<string> {
  const {
    tenant_id = "t1",
    workspace_id = "ws1",
    user_id = "u1",
    content_raw = "I prefer dark mode",
    memory_type = "episodic",
    tags = [],
    metadata = {},
  } = overrides;

  const { rows } = await p.query<{ memory_id: string }>(
    `INSERT INTO memories
       (tenant_id, workspace_id, user_id, content_raw, memory_type, tags, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING memory_id`,
    [
      tenant_id,
      workspace_id,
      user_id,
      content_raw,
      memory_type,
      JSON.stringify(tags),
      JSON.stringify(metadata),
    ]
  );
  return rows[0].memory_id;
}
