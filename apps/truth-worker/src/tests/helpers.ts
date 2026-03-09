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
 * Insert a semantic fact directly for testing. Returns the fact_id.
 */
export async function insertTestFact(
  p: Pool,
  overrides: Partial<{
    tenant_id: string;
    workspace_id: string;
    user_id: string;
    fact_type: string;
    subject: string;
    predicate: string;
    value_text: string;
    confidence: number;
    trust_score: number;
    source_type: string;
    truth_status: string;
    verification_count: number;
    rejection_count: number;
  }> = {}
): Promise<string> {
  const {
    tenant_id = "t1",
    workspace_id = "ws1",
    user_id = "u1",
    fact_type = "preference",
    subject = "user",
    predicate = "ide_theme",
    value_text = "dark",
    confidence = 0.7,
    trust_score = 0.7,
    source_type = "user",
    truth_status = "active",
    verification_count = 0,
    rejection_count = 0,
  } = overrides;

  const { rows } = await p.query<{ fact_id: string }>(
    `INSERT INTO semantic_facts
       (tenant_id, workspace_id, user_id, fact_type, subject, predicate,
        value_text, confidence, trust_score, source_type, truth_status,
        verification_count, rejection_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING fact_id`,
    [
      tenant_id,
      workspace_id,
      user_id,
      fact_type,
      subject,
      predicate,
      value_text,
      confidence,
      trust_score,
      source_type,
      truth_status,
      verification_count,
      rejection_count,
    ]
  );
  return rows[0].fact_id;
}

/**
 * Insert a contradiction pair for testing.
 */
export async function insertTestContradiction(
  p: Pool,
  factAId: string,
  factBId: string,
  overrides: Partial<{
    tenant_id: string;
    workspace_id: string;
    contradiction_type: string;
    resolution: string;
  }> = {}
): Promise<string> {
  const {
    tenant_id = "t1",
    workspace_id = "ws1",
    contradiction_type = "direct",
    resolution = "unresolved",
  } = overrides;

  const { rows } = await p.query<{ id: string }>(
    `INSERT INTO fact_contradictions
       (tenant_id, workspace_id, fact_a_id, fact_b_id, contradiction_type, resolution)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [tenant_id, workspace_id, factAId, factBId, contradiction_type, resolution]
  );
  return rows[0].id;
}
