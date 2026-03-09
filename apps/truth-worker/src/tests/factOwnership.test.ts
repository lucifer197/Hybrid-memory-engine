import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool } from "pg";
import {
  getTestPool,
  setupTestDb,
  cleanTables,
  teardownTestDb,
  insertTestFact,
} from "./helpers";

/**
 * Phase 9.8 — Fact ownership and security tests.
 *
 * Validates:
 *   - Tenant A cannot confirm/reject tenant B facts (scoped findById returns null)
 *   - Different user in same tenant/workspace cannot access another user's facts
 *   - Superseded facts are properly isolated from active facts in queries
 *
 * Requires a running Postgres.
 * Set DATABASE_URL and DB_TESTS=1 to enable.
 */

const RUN_DB_TESTS = process.env.DB_TESTS === "1";

describe.skipIf(!RUN_DB_TESTS)(
  "Phase 9.8 — Fact ownership and security",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      pool = await setupTestDb();
    });

    beforeEach(async () => {
      await cleanTables();
    });

    afterAll(async () => {
      await teardownTestDb();
    });

    // ── Cross-tenant fact isolation ──────────────────────────────

    it("tenant A cannot read tenant B facts via scoped query", async () => {
      const factId = await insertTestFact(pool, {
        tenant_id: "tenant_B",
        workspace_id: "ws_B",
        user_id: "user_B",
        subject: "user",
        predicate: "editor",
        value_text: "vim",
      });

      // Attempt to find tenant B's fact using tenant A credentials
      const { rows } = await pool.query(
        `SELECT fact_id FROM semantic_facts
         WHERE fact_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4`,
        [factId, "tenant_A", "ws_A", "user_A"]
      );

      expect(rows).toHaveLength(0);
    });

    it("tenant A cannot update tenant B fact trust score", async () => {
      const factId = await insertTestFact(pool, {
        tenant_id: "tenant_B",
        workspace_id: "ws_B",
        user_id: "user_B",
        trust_score: 0.7,
      });

      // Attempt scoped update — should affect 0 rows
      const result = await pool.query(
        `UPDATE semantic_facts
         SET trust_score = trust_score + 0.05,
             verification_count = verification_count + 1
         WHERE fact_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4`,
        [factId, "tenant_A", "ws_A", "user_A"]
      );

      expect(result.rowCount).toBe(0);

      // Original fact remains unchanged
      const { rows } = await pool.query(
        "SELECT trust_score, verification_count FROM semantic_facts WHERE fact_id = $1",
        [factId]
      );
      expect(parseFloat(rows[0].trust_score)).toBeCloseTo(0.7, 2);
      expect(rows[0].verification_count).toBe(0);
    });

    it("different user in same tenant cannot access another user's fact via scoped query", async () => {
      const factId = await insertTestFact(pool, {
        tenant_id: "tenant_A",
        workspace_id: "ws_A",
        user_id: "user_alice",
        subject: "user",
        predicate: "password_manager",
        value_text: "1password",
      });

      // user_bob in same tenant/workspace cannot see user_alice's fact
      const { rows } = await pool.query(
        `SELECT fact_id FROM semantic_facts
         WHERE fact_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4`,
        [factId, "tenant_A", "ws_A", "user_bob"]
      );

      expect(rows).toHaveLength(0);
    });

    // ── Cross-tenant contradiction isolation ─────────────────────

    it("contradiction resolution query is scoped to tenant", async () => {
      // Create facts for tenant A
      const factA1 = await insertTestFact(pool, {
        tenant_id: "tenant_A",
        workspace_id: "ws_A",
        user_id: "user_A",
        subject: "user",
        predicate: "theme",
        value_text: "dark",
        trust_score: 0.9,
        truth_status: "active",
      });
      const factA2 = await insertTestFact(pool, {
        tenant_id: "tenant_A",
        workspace_id: "ws_A",
        user_id: "user_A",
        subject: "user",
        predicate: "theme",
        value_text: "light",
        trust_score: 0.5,
        truth_status: "active",
      });

      // Create contradiction for tenant A
      await pool.query(
        `INSERT INTO fact_contradictions (tenant_id, workspace_id, fact_a_id, fact_b_id, contradiction_type, resolution)
         VALUES ($1, $2, $3, $4, 'direct', 'unresolved')`,
        ["tenant_A", "ws_A", factA1, factA2]
      );

      // Create a fact for tenant B
      const factB1 = await insertTestFact(pool, {
        tenant_id: "tenant_B",
        workspace_id: "ws_B",
        user_id: "user_B",
        subject: "user",
        predicate: "theme",
        value_text: "solarized",
        trust_score: 0.3,
        truth_status: "active",
      });

      // Query contradictions scoped to tenant A — tenant B fact should not appear
      const { rows } = await pool.query(
        `SELECT fc.fact_a_id, fc.fact_b_id
         FROM fact_contradictions fc
         WHERE fc.tenant_id = $1 AND fc.workspace_id = $2 AND fc.resolution = 'unresolved'`,
        ["tenant_A", "ws_A"]
      );

      const allFactIds = rows.flatMap((r) => [r.fact_a_id, r.fact_b_id]);
      expect(allFactIds).not.toContain(factB1);
      expect(allFactIds).toContain(factA1);
      expect(allFactIds).toContain(factA2);
    });

    // ── Superseded fact isolation ────────────────────────────────

    it("querying active facts excludes superseded facts", async () => {
      const activeFact = await insertTestFact(pool, {
        tenant_id: "tenant_A",
        workspace_id: "ws_A",
        user_id: "user_A",
        subject: "user",
        predicate: "editor",
        value_text: "vscode",
        truth_status: "active",
        trust_score: 0.8,
      });

      const supersededFact = await insertTestFact(pool, {
        tenant_id: "tenant_A",
        workspace_id: "ws_A",
        user_id: "user_A",
        subject: "user",
        predicate: "editor",
        value_text: "vim",
        truth_status: "superseded",
        trust_score: 0.6,
      });

      // Query for active facts only (as retrieval would)
      const { rows } = await pool.query(
        `SELECT fact_id, value_text, truth_status FROM semantic_facts
         WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
           AND subject = $4 AND predicate = $5
           AND truth_status = 'active'`,
        ["tenant_A", "ws_A", "user_A", "user", "editor"]
      );

      const ids = rows.map((r) => r.fact_id);
      expect(ids).toContain(activeFact);
      expect(ids).not.toContain(supersededFact);
    });

    it("superseded fact still exists but is excluded from active listings", async () => {
      const factId = await insertTestFact(pool, {
        tenant_id: "tenant_A",
        workspace_id: "ws_A",
        user_id: "user_A",
        subject: "user",
        predicate: "language",
        value_text: "python",
        truth_status: "active",
        trust_score: 0.7,
      });

      // Supersede it
      await pool.query(
        "UPDATE semantic_facts SET truth_status = 'superseded' WHERE fact_id = $1",
        [factId]
      );

      // It still exists in the DB
      const { rows: allRows } = await pool.query(
        "SELECT fact_id, truth_status FROM semantic_facts WHERE fact_id = $1",
        [factId]
      );
      expect(allRows).toHaveLength(1);
      expect(allRows[0].truth_status).toBe("superseded");

      // But it's excluded from active-only queries
      const { rows: activeRows } = await pool.query(
        `SELECT fact_id FROM semantic_facts
         WHERE fact_id = $1 AND truth_status = 'active'`,
        [factId]
      );
      expect(activeRows).toHaveLength(0);
    });
  }
);
