import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  setupTestDb,
  cleanTables,
  teardownTestDb,
  getTestPool,
  insertTestMemory,
} from "./helpers";
import { consolidateMemory } from "../jobs/consolidate_recent";
import { extractFacts } from "../services/factExtractor";
import { detectConflict } from "../services/conflictDetector";
import type { MemoryRow } from "../repositories/memoryRepo";
import type { Pool, PoolClient } from "pg";

const SKIP = !process.env.DB_TESTS;

describe.skipIf(SKIP)("consolidation-worker — regression tests", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = await setupTestDb();
  });
  afterAll(() => teardownTestDb());
  beforeEach(() => cleanTables());

  // ── Helper: run consolidateMemory inside a transaction ──────
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

  // ── Test: fact extraction from preference content ───────────
  describe("factExtractor", () => {
    it("extracts a preference fact from 'I prefer dark mode'", () => {
      const facts = extractFacts("I prefer dark mode", "episodic");
      expect(facts.length).toBeGreaterThanOrEqual(1);

      const pref = facts.find((f) => f.fact_type === "preference");
      expect(pref).toBeDefined();
      expect(pref!.predicate).toBe("ide_theme");
      expect(pref!.value_text).toContain("dark");
    });

    it("extracts a project fact from project-related content", () => {
      const facts = extractFacts(
        "Project Neptune uses React and TypeScript",
        "episodic",
        [],
        ["project:neptune"]
      );
      expect(facts.length).toBeGreaterThanOrEqual(1);

      const proj = facts.find((f) => f.fact_type === "project");
      expect(proj).toBeDefined();
      expect(proj!.subject).toContain("neptune");
    });

    it("extracts a profile fact from 'My name is Alice'", () => {
      const facts = extractFacts("My name is Alice", "episodic");
      expect(facts.length).toBeGreaterThanOrEqual(1);

      const profile = facts.find(
        (f) => f.fact_type === "profile" && f.predicate === "name"
      );
      expect(profile).toBeDefined();
      expect(profile!.value_text).toContain("Alice");
    });

    it("returns empty for content with no extractable facts", () => {
      const facts = extractFacts("The weather is nice today.", "episodic");
      expect(facts).toHaveLength(0);
    });

    it("boosts confidence for preference-type memory with preference tag", () => {
      const base = extractFacts("I prefer TypeScript", "episodic");
      const boosted = extractFacts("I prefer TypeScript", "preference", [
        "preference",
      ]);

      const baseConf = base[0]?.confidence ?? 0;
      const boostedConf = boosted[0]?.confidence ?? 0;
      expect(boostedConf).toBeGreaterThan(baseConf);
    });
  });

  // ── Test: conflict detection ────────────────────────────────
  describe("conflictDetector", () => {
    it("returns no_conflict when no existing fact", () => {
      const result = detectConflict(
        {
          fact_type: "preference",
          subject: "user",
          predicate: "ide_theme",
          value_text: "dark",
          confidence: 0.7,
          source: "user",
        },
        null
      );
      expect(result.kind).toBe("no_conflict");
    });

    it("returns reinforcement when values match", () => {
      const existing = {
        fact_id: "f1",
        value_text: "dark",
        confidence: 0.7,
        last_confirmed_at: new Date(),
      } as any;

      const result = detectConflict(
        {
          fact_type: "preference",
          subject: "user",
          predicate: "ide_theme",
          value_text: "dark",
          confidence: 0.7,
          source: "user",
        },
        existing
      );
      expect(result.kind).toBe("reinforcement");
    });

    it("detects contradiction on explicit override language", () => {
      const existing = {
        fact_id: "f1",
        value_text: "dark",
        confidence: 0.8,
        last_confirmed_at: new Date(),
      } as any;

      const result = detectConflict(
        {
          fact_type: "preference",
          subject: "user",
          predicate: "ide_theme",
          value_text: "light",
          confidence: 0.7,
          source: "user",
        },
        existing,
        {
          sourceContent: "Actually, I switched to light mode now.",
          sourceCreatedAt: new Date(),
        }
      );
      expect(result.kind).toBe("contradiction");
    });
  });

  // ── Test: consolidation creates a fact in the DB ────────────
  describe("consolidateMemory", () => {
    it("creates a semantic fact from a preference memory", async () => {
      const memoryId = await insertTestMemory(pool, {
        content_raw: "I prefer dark mode",
        memory_type: "preference",
        tags: ["preference"],
      });

      const memory: MemoryRow = {
        memory_id: memoryId,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
        content_summary: null,
        memory_type: "preference",
        tags: ["preference"],
        metadata: {},
        created_at: new Date(),
      };

      const result = await withTx((client) =>
        consolidateMemory(client, memory)
      );

      expect(result.factsExtracted).toBeGreaterThanOrEqual(1);
      expect(result.results.some((r) => r.action === "created")).toBe(true);

      // Verify the fact exists in the DB
      const { rows } = await pool.query(
        `SELECT * FROM semantic_facts
         WHERE tenant_id = 't1' AND workspace_id = 'ws1' AND status = 'active'`
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].fact_type).toBe("preference");
    });

    it("reinforces an existing fact when same value is seen again", async () => {
      // First consolidation: create the fact
      const memoryId1 = await insertTestMemory(pool, {
        content_raw: "I prefer dark mode",
        memory_type: "preference",
      });

      const memory1: MemoryRow = {
        memory_id: memoryId1,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
        content_summary: null,
        memory_type: "preference",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };

      await withTx((client) => consolidateMemory(client, memory1));

      // Second consolidation with same value
      const memoryId2 = await insertTestMemory(pool, {
        content_raw: "I prefer dark mode",
        memory_type: "preference",
      });

      const memory2: MemoryRow = {
        memory_id: memoryId2,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
        content_summary: null,
        memory_type: "preference",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };

      const result2 = await withTx((client) =>
        consolidateMemory(client, memory2)
      );

      expect(result2.results.some((r) => r.action === "reinforced")).toBe(true);
    });

    it("supersedes an old fact when correction language is used", async () => {
      // Create initial fact
      const memoryId1 = await insertTestMemory(pool, {
        content_raw: "I prefer dark mode",
        memory_type: "preference",
      });

      const memory1: MemoryRow = {
        memory_id: memoryId1,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
        content_summary: null,
        memory_type: "preference",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };

      await withTx((client) => consolidateMemory(client, memory1));

      // Correction: explicit override language
      const memoryId2 = await insertTestMemory(pool, {
        content_raw: "Actually, I switched to light mode now. I prefer light mode.",
        memory_type: "preference",
      });

      const memory2: MemoryRow = {
        memory_id: memoryId2,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "Actually, I switched to light mode now. I prefer light mode.",
        content_summary: null,
        memory_type: "preference",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };

      const result2 = await withTx((client) =>
        consolidateMemory(client, memory2)
      );

      expect(result2.results.some((r) => r.action === "superseded")).toBe(true);

      // Old fact should be superseded
      const { rows } = await pool.query(
        `SELECT status FROM semantic_facts
         WHERE tenant_id = 't1' AND workspace_id = 'ws1'
         ORDER BY created_at ASC`
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].status).toBe("superseded");
    });

    it("links evidence from source memory to the created fact", async () => {
      const memoryId = await insertTestMemory(pool, {
        content_raw: "My name is Alice",
        memory_type: "episodic",
      });

      const memory: MemoryRow = {
        memory_id: memoryId,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "My name is Alice",
        content_summary: null,
        memory_type: "episodic",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };

      const result = await withTx((client) =>
        consolidateMemory(client, memory)
      );

      const createdFact = result.results.find((r) => r.action === "created");
      expect(createdFact).toBeDefined();

      // Verify evidence link
      const { rows } = await pool.query(
        `SELECT * FROM fact_evidence WHERE fact_id = $1`,
        [createdFact!.factId]
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].memory_id).toBe(memoryId);
    });

    it("records audit events for created facts", async () => {
      const memoryId = await insertTestMemory(pool, {
        content_raw: "My name is Bob",
        memory_type: "episodic",
      });

      const memory: MemoryRow = {
        memory_id: memoryId,
        tenant_id: "t1",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "My name is Bob",
        content_summary: null,
        memory_type: "episodic",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };

      const result = await withTx((client) =>
        consolidateMemory(client, memory)
      );

      const createdFact = result.results.find((r) => r.action === "created");
      expect(createdFact).toBeDefined();

      // Verify audit event
      const { rows } = await pool.query(
        `SELECT * FROM fact_events WHERE fact_id = $1 AND event_type = 'created'`,
        [createdFact!.factId]
      );
      expect(rows).toHaveLength(1);
    });

    it("isolates facts between tenants", async () => {
      // Tenant A fact
      const memIdA = await insertTestMemory(pool, {
        tenant_id: "tenant-a",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
      });
      const memA: MemoryRow = {
        memory_id: memIdA,
        tenant_id: "tenant-a",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
        content_summary: null,
        memory_type: "episodic",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };
      await withTx((client) => consolidateMemory(client, memA));

      // Tenant B same content — should NOT reinforce tenant A's fact
      const memIdB = await insertTestMemory(pool, {
        tenant_id: "tenant-b",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
      });
      const memB: MemoryRow = {
        memory_id: memIdB,
        tenant_id: "tenant-b",
        workspace_id: "ws1",
        user_id: "u1",
        content_raw: "I prefer dark mode",
        content_summary: null,
        memory_type: "episodic",
        tags: [],
        metadata: {},
        created_at: new Date(),
      };
      const resultB = await withTx((client) => consolidateMemory(client, memB));

      // Tenant B should get a new fact (created), not reinforced
      expect(resultB.results.some((r) => r.action === "created")).toBe(true);

      // Each tenant should have their own active fact
      const { rows: factsA } = await pool.query(
        `SELECT * FROM semantic_facts WHERE tenant_id = 'tenant-a' AND status = 'active'`
      );
      const { rows: factsB } = await pool.query(
        `SELECT * FROM semantic_facts WHERE tenant_id = 'tenant-b' AND status = 'active'`
      );
      expect(factsA.length).toBeGreaterThanOrEqual(1);
      expect(factsB.length).toBeGreaterThanOrEqual(1);
    });
  });
});
