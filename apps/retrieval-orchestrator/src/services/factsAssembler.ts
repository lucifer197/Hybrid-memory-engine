import type { FactRefDTO } from "@hybrid-memory/shared-types";
import {
  findFactsByKeywords,
  findFactsByMemoryIds,
  type FactWithEvidence,
} from "../repositories/factRepo";
import { rankCandidate } from "./fusionRanker";
import {
  factRecencyScore,
  verificationScore,
  truthScore,
  importanceScore,
} from "./scoreSignals";
import { factToContextBlock } from "./evidenceBuilder";
import { createLogger } from "@hybrid-memory/observability";

const log = createLogger("retrieval-orchestrator", "factsAssembler");

/**
 * Extract simple keywords from a query string for fact lookup.
 * Strips common stop-words and returns unique lowercased tokens ≥3 chars.
 */
function extractKeywords(query: string): string[] {
  const STOP = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "about", "what",
    "which", "who", "whom", "this", "that", "these", "those", "it",
    "its", "my", "your", "his", "her", "our", "their", "and", "or",
    "but", "not", "no", "nor", "so", "yet", "if", "then", "how", "when",
    "where", "why", "all", "each", "every", "both", "few", "more",
    "most", "other", "some", "such", "than", "too", "very", "just",
    "me", "i", "you", "he", "she", "we", "they",
  ]);

  return [...new Set(
    query
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w))
  )];
}

/**
 * Convert a database fact row into the API DTO with truth-aware scoring
 * using the unified fusion ranker.
 */
function factToDTO(fact: FactWithEvidence, relevance: number): FactRefDTO {
  const vCount = fact.verification_count ?? 0;
  const rCount = fact.rejection_count ?? 0;
  const trust = fact.trust_score ?? 0.55;
  const conf = fact.confidence;
  const status = fact.truth_status ?? fact.status;

  const breakdown = rankCandidate({
    candidate_type: "fact",
    vector_score: relevance,
    graph_score: 0,
    recency_score: factRecencyScore(fact.last_verified_at ?? null),
    stability_score: verificationScore(vCount, rCount),
    truth_score: truthScore(trust, conf, vCount, rCount),
    importance_score: importanceScore(null, fact.fact_type),
    is_archived: false,
    truth_status: status,
    confidence: conf,
    rejection_count: rCount,
  });

  return {
    fact_id: fact.fact_id,
    fact_type: fact.fact_type,
    subject: fact.subject,
    predicate: fact.predicate,
    value_text: fact.value_text,
    value_json: fact.value_json ?? undefined,
    confidence: conf,
    status,
    trust_score: trust,
    score: breakdown.final_score,
    verification_count: vCount,
    rejection_count: rCount,
    evidence_memory_ids: Array.isArray(fact.evidence_memory_ids)
      ? fact.evidence_memory_ids
      : [],
  };
}

export interface FactsAssemblyResult {
  /** FactRefDTOs sorted by score descending. */
  facts: FactRefDTO[];
  /** Context block strings for facts (to prepend to context_blocks). */
  factBlocks: string[];
}

/**
 * Assemble facts relevant to a retrieval query.
 *
 * Two lookup strategies run in parallel:
 *   1. Keyword match — extract keywords from query, match against subject/predicate/value
 *   2. Evidence overlap — find facts linked to the same memories that vector search returned
 *
 * Results are deduplicated by fact_id, scored with truth-aware ranking, and sorted.
 */
export async function assembleFacts(
  tenantId: string,
  workspaceId: string,
  userId: string,
  query: string,
  candidateMemoryIds: string[],
  topFusionScore: number
): Promise<FactsAssemblyResult> {
  const keywords = extractKeywords(query);

  // Run both lookups in parallel
  const [keywordFacts, evidenceFacts] = await Promise.all([
    findFactsByKeywords(tenantId, workspaceId, userId, keywords),
    findFactsByMemoryIds(tenantId, workspaceId, candidateMemoryIds),
  ]);

  // Deduplicate by fact_id, keeping the higher-confidence row
  const factMap = new Map<string, FactWithEvidence>();
  for (const f of [...keywordFacts, ...evidenceFacts]) {
    const existing = factMap.get(f.fact_id);
    if (!existing || f.confidence > existing.confidence) {
      factMap.set(f.fact_id, f);
    }
  }

  // Use top fusion score as the relevance signal for facts
  const relevance = Math.min(topFusionScore + 0.1, 1.0);

  // Convert to DTOs with truth-aware scores
  const facts = Array.from(factMap.values())
    .map((f) => factToDTO(f, relevance))
    .sort((a, b) => b.score - a.score);

  const factBlocks = facts.map(factToContextBlock);

  log.debug("facts_assembled", {
    keyword_hits: keywordFacts.length,
    evidence_hits: evidenceFacts.length,
    deduped: facts.length,
  });

  return { facts, factBlocks };
}
