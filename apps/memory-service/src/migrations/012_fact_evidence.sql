-- 012_fact_evidence.sql — Traceability: which raw memories support each fact

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- fact_evidence — links facts back to source episodic memories
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS fact_evidence (
  fact_id     UUID            NOT NULL REFERENCES semantic_facts(fact_id) ON DELETE CASCADE,
  memory_id   UUID            NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
  weight      DOUBLE PRECISION NOT NULL DEFAULT 1.0
              CHECK (weight >= 0 AND weight <= 1),
  created_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),

  PRIMARY KEY (fact_id, memory_id)
);

-- Reverse lookup: given a memory, find all facts it supports
CREATE INDEX IF NOT EXISTS idx_fact_evidence_memory
  ON fact_evidence (memory_id);

-- Forward lookup: given a fact, find all evidence (covered by PK but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_fact_evidence_fact
  ON fact_evidence (fact_id);

COMMIT;
