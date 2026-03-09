import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool, closePool } from "../db";

/**
 * Simple migration runner — executes SQL files in order.
 * Usage: ts-node src/migrations/run.ts
 */
async function runMigrations() {
  const pool = getPool();
  const migrationsDir = __dirname;

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
  ];

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    console.log(`Running ${file}...`);
    await pool.query(sql);
    console.log(`  ✓ ${file}`);
  }

  await closePool();
  console.log("Migrations complete.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
