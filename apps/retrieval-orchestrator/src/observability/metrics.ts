import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

// Retrieve path metrics
export const retrievalRequests = registry.createCounter("retrieval_requests_total");
export const retrievalLatency = registry.createHistogram("retrieval_latency_ms");
export const vectorCandidatesCount = registry.createHistogram("vector_candidates_count");
export const graphCandidatesCount = registry.createHistogram("graph_candidates_count");
export const candidateCount = registry.createHistogram("retrieval_candidate_count");
export const factsReturnedCount = registry.createHistogram("facts_returned_count");
export const scoreDist = registry.createHistogram("retrieval_final_score");
export const retrievalEmptyResults = registry.createCounter("retrieval_empty_results_total");
export const configCacheHits = registry.createCounter("retrieval_config_cache_hit_total");
export const configCacheMisses = registry.createCounter("retrieval_config_cache_miss_total");

// Pipeline stage metrics
export const stage1Latency = registry.createHistogram("stage1_latency_ms");
export const stage2Latency = registry.createHistogram("stage2_latency_ms");
export const stage3Latency = registry.createHistogram("stage3_latency_ms");
export const stage1CandidateCount = registry.createHistogram("stage1_candidate_count");
export const stage2CandidateCount = registry.createHistogram("stage2_candidate_count");
export const contextSizeCount = registry.createHistogram("context_size_count");

// Reliability metrics
export const timeoutTotal = registry.createCounter("timeout_total");
export const retryAttemptTotal = registry.createCounter("retry_attempt_total");
export const cbStateChange = registry.createCounter("circuit_breaker_state_change_total");

// Cache metrics
export const embedCacheHits = registry.createCounter("embed_cache_hit_total");
export const embedCacheMisses = registry.createCounter("embed_cache_miss_total");
export const retrievalCacheHits = registry.createCounter("retrieval_cache_hit_total");
export const retrievalCacheMisses = registry.createCounter("retrieval_cache_miss_total");
