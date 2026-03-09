import type { Stage2Candidate } from "./stage2HybridRanking";

/**
 * Build prompt-ready context blocks from ranked candidates.
 * Each block is a self-contained string an LLM can consume directly.
 */
export function buildContextBlocks(candidates: Stage2Candidate[]): string[] {
  return candidates.map((c) => {
    const score = c.final_score.toFixed(2);
    const date = c.created_at instanceof Date
      ? c.created_at.toISOString().split("T")[0]
      : String(c.created_at).split("T")[0];

    return [
      `[Memory | type=${c.memory_type} | score=${score} | date=${date}]`,
      c.chunk_text,
    ].join("\n");
  });
}
