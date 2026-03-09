import type { FactRefDTO } from "@hybrid-memory/shared-types";

/**
 * Build an evidence-rich context block for a fact.
 *
 * Includes truth_status, trust_score, and evidence summary
 * so downstream LLMs can weigh the fact appropriately.
 */
export function factToContextBlock(dto: FactRefDTO): string {
  const parts: string[] = [];

  // Status badge
  if (dto.status === "contested") parts.push("[contested]");
  else if (dto.status === "superseded") parts.push("[superseded]");

  // Core fact
  parts.push(`${dto.subject}.${dto.predicate} = ${dto.value_text}`);

  // Trust indicators
  const indicators: string[] = [];
  indicators.push(`confidence: ${dto.confidence.toFixed(2)}`);
  if (dto.trust_score != null) {
    indicators.push(`trust: ${dto.trust_score.toFixed(2)}`);
  }
  if (dto.verification_count != null && dto.verification_count > 0) {
    indicators.push(`verified: ${dto.verification_count}×`);
  }
  if (dto.rejection_count != null && dto.rejection_count > 0) {
    indicators.push(`rejected: ${dto.rejection_count}×`);
  }

  parts.push(`(${indicators.join(", ")})`);

  // Evidence summary
  const evidenceCount = dto.evidence_memory_ids?.length ?? 0;
  if (evidenceCount > 0) {
    const top3 = dto.evidence_memory_ids.slice(0, 3);
    parts.push(`[evidence: ${top3.join(", ")}${evidenceCount > 3 ? ` +${evidenceCount - 3} more` : ""}]`);
  }

  return `[Fact] ${parts.join(" ")}`;
}
