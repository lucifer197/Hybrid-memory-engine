import { getPool, closePool } from "../db";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Ensure migrations are applied and tables are clean before each test suite.
 */
export async function setupTestDb() {
  const pool = getPool();

  // Run migrations (idempotent thanks to IF NOT EXISTS)
  const migrationsDir = join(__dirname, "..", "migrations");
  for (const file of ["001_init.sql", "002_indexes.sql"]) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    await pool.query(sql);
  }

  return pool;
}

/** Wipe all rows so tests are isolated. */
export async function cleanTables() {
  const pool = getPool();
  await pool.query("TRUNCATE memory_chunks, memories, turn_writes CASCADE");
}

export async function teardownTestDb() {
  await closePool();
}
