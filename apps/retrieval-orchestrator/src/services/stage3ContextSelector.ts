/**
 * Stage 3 — Context Selection
 *
 * The final stage of the three-stage retrieval pipeline.
 * Takes the top ~20 candidates from Stage 2 and selects the best
 * context items to return to the AI model.
 *
 * Operations:
 *   1. Deduplicate — max 1 chunk per memory_id
 *   2. Prioritize — verified facts > confirmed facts > stable memories > recent episodic
 *   3. Compose — merge facts + memories within budget
 *   4. Build context blocks
 *
 * Target latency: < 30 ms (pure in-memory, no I/O)
 */

import type { Stage2Candidate } from "./stage2HybridRanking";
import type { FactRefDTO, MemoryRefDTO, DebugInfo } from "@hybrid-memory/shared-types";
import { toRankingDebugInfo } from "./rankingDebug";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("retrieval-orchestrator", "stage3");

// ── Configuration ───────────────────────────────────────────────

export interface ContextSelectionConfig {
  /** Max total context items returned. Default 5. */
  maxContextItems: number;
  /** Max fact slots in the final context. Default 3. */
  maxFacts: number;
  /** Max memory slots in the final context. Default 2. */
  maxMemories: number;
  /** Max chunks from the same memory_id. Default 1. */
  maxChunksPerMemory: number;
}

const DEFAULT_CONFIG: ContextSelectionConfig = {
  maxContextItems: 5,
  maxFacts: 3,
  maxMemories: 2,
  maxChunksPerMemory: 1,
};

// ── Output type ─────────────────────────────────────────────────

export interface Stage3Result {
  /** Final context blocks for LLM consumption (facts first, then memories). */
  context_blocks: string[];
  /** Memory DTOs for the response. */
  memories: MemoryRefDTO[];
  /** Fact DTOs (if facts were provided). */
  facts: FactRefDTO[];
  /** Debug info per selected item (when debug=true). */
  debug_info: DebugInfo[];
  /** How many candidates were considered. */
  candidates_in: number;
  /** How many items were selected. */
  items_selected: number;
  selection_ms: number;
}

// ── Main function ───────────────────────────────────────────────

/**
 * Execute Stage 3: select and compose the final context.
 *
 * @param candidates  Ranked candidates from Stage 2
 * @param facts       Scored facts from factsAssembler (already sorted by score)
 * @param factBlocks  Pre-built context blocks for facts
 * @param retrievalMs Total pipeline latency so far (for debug info)
 * @param debug       Whether to include score breakdowns
 * @param config      Selection limits (optional overrides)
 */
export function stage3ContextSelector(
  candidates: Stage2Candidate[],
  facts: FactRefDTO[],
  factBlocks: string[],
  retrievalMs: number,
  debug: boolean,
  config?: Partial<ContextSelectionConfig>
): Stage3Result {
  const start = performance.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── 1. Deduplicate candidates (1 best chunk per memory) ─────
  const deduped = deduplicateByMemory(candidates, cfg.maxChunksPerMemory);

  // ── 2. Select facts (up to maxFacts) ────────────────────────
  const selectedFacts = facts.slice(0, cfg.maxFacts);
  const selectedFactBlocks = factBlocks.slice(0, cfg.maxFacts);

  // ── 3. Select memories to fill remaining slots ──────────────
  const memorySlots = Math.min(
    cfg.maxMemories,
    cfg.maxContextItems - selectedFacts.length
  );
  const selectedMemories = deduped.slice(0, Math.max(0, memorySlots));

  // ── 4. Build memory DTOs ────────────────────────────────────
  const memoryDTOs: MemoryRefDTO[] = selectedMemories.map((c) => ({
    memory_id: c.memory_id,
    content: c.chunk_text,
    memory_type: c.memory_type,
    score: parseFloat(c.final_score.toFixed(4)),
    created_at:
      c.created_at instanceof Date
        ? c.created_at.toISOString()
        : String(c.created_at),
    metadata: c.metadata,
  }));

  // ── 5. Build context blocks (facts first, then memories) ────
  const memoryBlocks = selectedMemories.map((c) => {
    const score = c.final_score.toFixed(2);
    const date =
      c.created_at instanceof Date
        ? c.created_at.toISOString().split("T")[0]
        : String(c.created_at).split("T")[0];
    return [
      `[Memory | type=${c.memory_type} | score=${score} | date=${date}]`,
      c.chunk_text,
    ].join("\n");
  });

  const contextBlocks = [...selectedFactBlocks, ...memoryBlocks];

  // ── 6. Debug info ───────────────────────────────────────────
  const debugInfo: DebugInfo[] = debug
    ? selectedMemories.map((c) =>
        toRankingDebugInfo(
          {
            breakdown: c.breakdown,
            hop_depth: c.hop_depth,
            is_archived: c.is_archived,
            memory_id: c.memory_id,
          },
          retrievalMs
        )
      )
    : [];

  const selection_ms = performance.now() - start;

  // ── 7. Logging ──────────────────────────────────────────────
  log.info("stage3_complete", {
    candidates_in: candidates.length,
    deduped: deduped.length,
    facts_selected: selectedFacts.length,
    memories_selected: selectedMemories.length,
    context_blocks: contextBlocks.length,
    selection_ms: Math.round(selection_ms),
  });

  return {
    context_blocks: contextBlocks,
    memories: memoryDTOs,
    facts: selectedFacts,
    debug_info: debugInfo,
    candidates_in: candidates.length,
    items_selected: selectedFacts.length + selectedMemories.length,
    selection_ms,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Keep only the top N chunks per memory_id.
 * Candidates must already be sorted by final_score DESC.
 */
function deduplicateByMemory(
  candidates: Stage2Candidate[],
  maxPerMemory: number
): Stage2Candidate[] {
  const counts = new Map<string, number>();
  const result: Stage2Candidate[] = [];

  for (const c of candidates) {
    const count = counts.get(c.memory_id) ?? 0;
    if (count < maxPerMemory) {
      result.push(c);
      counts.set(c.memory_id, count + 1);
    }
  }

  return result;
}
