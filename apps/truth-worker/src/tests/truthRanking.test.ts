import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  setupTestDb,
  cleanTables,
  teardownTestDb,
  getTestPool,
  insertTestFact,
  insertTestContradiction,
} from "./helpers";
import { resolveContradictions } from "../jobs/resolve_contradictions";
import { reviewStaleFacts } from "../jobs/stale_fact_review";
import type { Pool, PoolClient } from "pg";

const SKIP = !process.env.DB_TESTS;

describe.skipIf(SKIP)("truth-worker — regression tests", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await setupTestDb();
  });
  afterAll(() => teardownTestDb());
  beforeEach(() => cleanTables());

  async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Trust gap resolution ────────────────────────────────────
  describe("resolveContradictions", () => {
    it("supersedes lower-trust fact when trust gap is large enough", async () => {
      const highTrust = await insertTestFact(pool, {
        subject: "user",
        predicate: "ide_theme",
        value_text: "dark",
        trust_score: 0.9,
        confidence: 0.9,
      });

      const lowTrust = await insertTestFact(pool, {
        subject: "user",
        predicate: "ide_theme",
        value_text: "light",
        trust_score: 0.4,
        confidence: 0.5,
      });

      await insertTestContradiction(pool, highTrust, lowTrust);

      const resolved = await withTx((client) =>
        resolveContradictions(client, 100)
      );
      expect(resolved).toBe(1);

      // Low-trust fact should be superseded
      const { rows } = await pool.query(
        `SELECT status, truth_status FROM semantic_facts WHERE fact_id = $1`,
        [lowTrust]
      );
      expect(rows[0].status).toBe("superseded");
      expect(rows[0].truth_status).toBe("superseded");
    });

    it("prefers tool-sourced fact over assistant-sourced fact", async () => {
      const toolFact = await insertTestFact(pool, {
        subject: "user",
        predicate: "timezone",
        value_text: "America/New_York",
        trust_score: 0.6,
        confidence: 0.6,
        source_type: "tool",
      });

      const assistantFact = await insertTestFact(pool, {
        subject: "user",
        predicate: "timezone",
        value_text: "America/Chicago",
        trust_score: 0.6,
        confidence: 0.6,
        source_type: "assistant",
      });

      await insertTestContradiction(pool, toolFact, assistantFact);

      const resolved = await withTx((client) =>
        resolveContradictions(client, 100)
      );
      expect(resolved).toBe(1);

      // Assistant fact should be superseded
      const { rows } = await pool.query(
        `SELECT status FROM semantic_facts WHERE fact_id = $1`,
        [assistantFact]
      );
      expect(rows[0].status).toBe("superseded");

      // Tool fact should remain active
      const { rows: toolRows } = await pool.query(
        `SELECT status FROM semantic_facts WHERE fact_id = $1`,
        [toolFact]
      );
      expect(toolRows[0].status).toBe("active");
    });

    it("marks both facts as contested when gap is too small", async () => {
      const factA = await insertTestFact(pool, {
        subject: "user",
        predicate: "editor",
        value_text: "vscode",
        trust_score: 0.6,
        confidence: 0.6,
        source_type: "user",
        verification_count: 1,
        rejection_count: 0,
      });

      const factB = await insertTestFact(pool, {
        subject: "user",
        predicate: "editor",
        value_text: "neovim",
        trust_score: 0.55,
        confidence: 0.55,
        source_type: "user",
        verification_count: 0,
        rejection_count: 0,
      });

      await insertTestContradiction(pool, factA, factB);

      await withTx((client) => resolveContradictions(client, 100));

      // Both should be contested
      const { rows } = await pool.query(
        `SELECT fact_id, truth_status FROM semantic_facts
         WHERE fact_id IN ($1, $2)
         ORDER BY fact_id`,
        [factA, factB]
      );
      for (const row of rows) {
        expect(row.truth_status).toBe("contested");
      }
    });

    it("does nothing when there are no unresolved contradictions", async () => {
      const resolved = await withTx((client) =>
        resolveContradictions(client, 100)
      );
      expect(resolved).toBe(0);
    });

    it("auto-resolves when one fact was already superseded", async () => {
      const factA = await insertTestFact(pool, {
        subject: "user",
        predicate: "language",
        value_text: "typescript",
        trust_score: 0.7,
        truth_status: "superseded",
      });
      // Mark it as superseded in the DB
      await pool.query(
        `UPDATE semantic_facts SET truth_status = 'superseded', status = 'superseded' WHERE fact_id = $1`,
        [factA]
      );

      const factB = await insertTestFact(pool, {
        subject: "user",
        predicate: "language",
        value_text: "rust",
        trust_score: 0.8,
      });

      await insertTestContradiction(pool, factA, factB);

      const resolved = await withTx((client) =>
        resolveContradictions(client, 100)
      );
      expect(resolved).toBe(1);

      // Contradiction should be resolved
      const { rows } = await pool.query(
        `SELECT resolution FROM fact_contradictions
         WHERE fact_a_id = $1 AND fact_b_id = $2`,
        [factA, factB]
      );
      expect(rows[0].resolution).toBe("superseded");
    });

    it("resolves by verification count advantage (>=3)", async () => {
      const wellVerified = await insertTestFact(pool, {
        subject: "user",
        predicate: "font",
        value_text: "JetBrains Mono",
        trust_score: 0.65,
        confidence: 0.65,
        source_type: "user",
        verification_count: 5,
        rejection_count: 0,
      });

      const poorlyVerified = await insertTestFact(pool, {
        subject: "user",
        predicate: "font",
        value_text: "Fira Code",
        trust_score: 0.6,
        confidence: 0.6,
        source_type: "user",
        verification_count: 1,
        rejection_count: 0,
      });

      await insertTestContradiction(pool, wellVerified, poorlyVerified);

      const resolved = await withTx((client) =>
        resolveContradictions(client, 100)
      );
      expect(resolved).toBe(1);

      // Poorly verified fact should be superseded
      const { rows } = await pool.query(
        `SELECT status FROM semantic_facts WHERE fact_id = $1`,
        [poorlyVerified]
      );
      expect(rows[0].status).toBe("superseded");
    });
  });

  // ── Stale fact review ───────────────────────────────────────
  describe("reviewStaleFacts", () => {
    it("downgrades stale facts that haven't been verified", async () => {
      // Insert a fact with old last_verified_at
      const factId = await insertTestFact(pool, {
        trust_score: 0.6,
        confidence: 0.6,
        truth_status: "active",
      });

      // Backdate to make it stale (> 90 days)
      await pool.query(
        `UPDATE semantic_facts
         SET created_at = now() - interval '120 days',
             last_verified_at = NULL
         WHERE fact_id = $1`,
        [factId]
      );

      const count = await withTx((client) => reviewStaleFacts(client, 100));
      expect(count).toBe(1);

      // Trust and confidence should have decreased
      const { rows } = await pool.query(
        `SELECT trust_score, confidence FROM semantic_facts WHERE fact_id = $1`,
        [factId]
      );
      expect(rows[0].trust_score).toBeLessThan(0.6);
      expect(rows[0].confidence).toBeLessThan(0.6);
    });

    it("marks fact as unknown when trust drops below 0.20", async () => {
      const factId = await insertTestFact(pool, {
        trust_score: 0.15,
        confidence: 0.2,
        truth_status: "active",
      });

      await pool.query(
        `UPDATE semantic_facts
         SET created_at = now() - interval '120 days',
             last_verified_at = NULL
         WHERE fact_id = $1`,
        [factId]
      );

      await withTx((client) => reviewStaleFacts(client, 100));

      const { rows } = await pool.query(
        `SELECT truth_status, status FROM semantic_facts WHERE fact_id = $1`,
        [factId]
      );
      expect(rows[0].truth_status).toBe("unknown");
      expect(rows[0].status).toBe("contested");
    });

    it("decays tool-sourced facts more slowly", async () => {
      const userFact = await insertTestFact(pool, {
        subject: "user",
        predicate: "theme_user",
        trust_score: 0.5,
        confidence: 0.5,
        source_type: "user",
        truth_status: "active",
      });

      const toolFact = await insertTestFact(pool, {
        subject: "user",
        predicate: "theme_tool",
        trust_score: 0.5,
        confidence: 0.5,
        source_type: "tool",
        truth_status: "active",
      });

      // Backdate both
      await pool.query(
        `UPDATE semantic_facts
         SET created_at = now() - interval '120 days',
             last_verified_at = NULL
         WHERE fact_id IN ($1, $2)`,
        [userFact, toolFact]
      );

      await withTx((client) => reviewStaleFacts(client, 100));

      const { rows: userRows } = await pool.query(
        `SELECT trust_score FROM semantic_facts WHERE fact_id = $1`,
        [userFact]
      );
      const { rows: toolRows } = await pool.query(
        `SELECT trust_score FROM semantic_facts WHERE fact_id = $1`,
        [toolFact]
      );

      // Tool fact should retain higher trust (half penalty)
      expect(toolRows[0].trust_score).toBeGreaterThan(userRows[0].trust_score);
    });
  });

  // ── Cross-tenant isolation ──────────────────────────────────
  describe("cross-tenant isolation", () => {
    it("contradictions from tenant A do not affect tenant B facts", async () => {
      // Tenant A facts with contradiction
      const factA1 = await insertTestFact(pool, {
        tenant_id: "tenant-a",
        subject: "user",
        predicate: "lang",
        value_text: "python",
        trust_score: 0.9,
      });
      const factA2 = await insertTestFact(pool, {
        tenant_id: "tenant-a",
        subject: "user",
        predicate: "lang",
        value_text: "ruby",
        trust_score: 0.3,
      });
      await insertTestContradiction(pool, factA1, factA2, {
        tenant_id: "tenant-a",
      });

      // Tenant B has a fact with same predicate
      const factB = await insertTestFact(pool, {
        tenant_id: "tenant-b",
        subject: "user",
        predicate: "lang",
        value_text: "java",
        trust_score: 0.5,
      });

      await withTx((client) => resolveContradictions(client, 100));

      // Tenant B fact should be unaffected
      const { rows } = await pool.query(
        `SELECT status, truth_status FROM semantic_facts WHERE fact_id = $1`,
        [factB]
      );
      expect(rows[0].status).toBe("active");
      expect(rows[0].truth_status).toBe("active");
    });
  });
});
