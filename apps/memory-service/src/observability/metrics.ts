import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

// Write path metrics
export const writeTurnRequests = registry.createCounter("write_turn_requests_total");
export const writeTurnLatency = registry.createHistogram("write_turn_latency_ms");
export const memoryRowsCreated = registry.createCounter("memory_rows_created_total");
export const chunksCreated = registry.createCounter("chunks_created_total");
export const chunkCountDist = registry.createHistogram("chunk_count_per_turn");
export const embedJobEnqueueCount = registry.createCounter("embed_job_enqueue_total");
export const embedJobEnqueueFailures = registry.createCounter("embed_job_enqueue_failures_total");

// Facts feedback metrics
export const factsConfirmed = registry.createCounter("facts_confirmed_total");
export const factsRejected = registry.createCounter("facts_rejected_total");

// Forget path metrics
export const forgetLatency = registry.createHistogram("forget_latency_ms");
export const forgetDeletedCount = registry.createCounter("forget_deleted_total");
