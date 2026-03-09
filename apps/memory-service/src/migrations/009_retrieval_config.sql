-- 009_retrieval_config.sql — Per-tenant/workspace retrieval configuration
-- Safe to re-run (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS retrieval_config (
  id              BIGSERIAL       PRIMARY KEY,
  tenant_id       TEXT            NOT NULL,
  workspace_id    TEXT            NOT NULL,
  version         INTEGER         NOT NULL DEFAULT 1,

  -- ── Fusion scoring weights (must sum to 1.0) ──────────────
  vector_weight       DOUBLE PRECISION NOT NULL DEFAULT 0.55
                      CHECK (vector_weight >= 0 AND vector_weight <= 1),
  graph_weight        DOUBLE PRECISION NOT NULL DEFAULT 0.20
                      CHECK (graph_weight >= 0 AND graph_weight <= 1),
  recency_weight      DOUBLE PRECISION NOT NULL DEFAULT 0.15
                      CHECK (recency_weight >= 0 AND recency_weight <= 1),
  stability_weight    DOUBLE PRECISION NOT NULL DEFAULT 0.07
                      CHECK (stability_weight >= 0 AND stability_weight <= 1),
  importance_weight   DOUBLE PRECISION NOT NULL DEFAULT 0.03
                      CHECK (importance_weight >= 0 AND importance_weight <= 1),

  -- ── Archived penalty ──────────────────────────────────────
  archived_penalty    DOUBLE PRECISION NOT NULL DEFAULT 0.70
                      CHECK (archived_penalty >= 0 AND archived_penalty <= 1),

  -- ── Recency half-lives (hours) ────────────────────────────
  recency_half_life_episodic_hours  DOUBLE PRECISION NOT NULL DEFAULT 72
                      CHECK (recency_half_life_episodic_hours > 0),
  recency_half_life_semantic_hours  DOUBLE PRECISION NOT NULL DEFAULT 720
                      CHECK (recency_half_life_semantic_hours > 0),

  -- ── Graph expansion limits ────────────────────────────────
  max_neighbors_per_seed  INTEGER NOT NULL DEFAULT 5
                      CHECK (max_neighbors_per_seed >= 1 AND max_neighbors_per_seed <= 50),
  max_graph_candidates    INTEGER NOT NULL DEFAULT 50
                      CHECK (max_graph_candidates >= 1 AND max_graph_candidates <= 500),
  max_hops                INTEGER NOT NULL DEFAULT 1
                      CHECK (max_hops >= 1 AND max_hops <= 3),

  -- ── Retrieval limits ──────────────────────────────────────
  max_candidates          INTEGER NOT NULL DEFAULT 100
                      CHECK (max_candidates >= 1 AND max_candidates <= 1000),
  max_chunks_per_memory   INTEGER NOT NULL DEFAULT 2
                      CHECK (max_chunks_per_memory >= 1 AND max_chunks_per_memory <= 10),

  -- ── Decay thresholds ──────────────────────────────────────
  decay_stability_floor       DOUBLE PRECISION NOT NULL DEFAULT 0.05
                      CHECK (decay_stability_floor >= 0 AND decay_stability_floor <= 1),
  decay_archive_stability     DOUBLE PRECISION NOT NULL DEFAULT 0.25
                      CHECK (decay_archive_stability >= 0 AND decay_archive_stability <= 1),
  decay_archive_min_age_days  INTEGER NOT NULL DEFAULT 30
                      CHECK (decay_archive_min_age_days >= 1),

  -- ── Consolidation thresholds ──────────────────────────────
  consolidation_similarity_threshold  DOUBLE PRECISION NOT NULL DEFAULT 0.85
                      CHECK (consolidation_similarity_threshold >= 0 AND consolidation_similarity_threshold <= 1),
  consolidation_min_cluster_size      INTEGER NOT NULL DEFAULT 3
                      CHECK (consolidation_min_cluster_size >= 2),
  consolidation_max_age_days          INTEGER NOT NULL DEFAULT 30
                      CHECK (consolidation_max_age_days >= 1),

  -- ── Timestamps ────────────────────────────────────────────
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- One config row per tenant+workspace
  CONSTRAINT uq_retrieval_config_tenant_ws
    UNIQUE (tenant_id, workspace_id)
);

-- Fast lookup by tenant + workspace
CREATE INDEX IF NOT EXISTS idx_retrieval_config_lookup
  ON retrieval_config (tenant_id, workspace_id);

COMMIT;
