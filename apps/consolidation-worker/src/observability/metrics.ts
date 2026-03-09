import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

export const consolidationJobSuccess = registry.createCounter("consolidation_job_success_total");
export const consolidationJobFailure = registry.createCounter("consolidation_job_failure_total");
export const consolidationJobLatency = registry.createHistogram("consolidation_job_latency_ms");

export const factsCreated = registry.createCounter("consolidation_facts_created_total");
export const factsReinforced = registry.createCounter("consolidation_facts_reinforced_total");
export const factsSuperseded = registry.createCounter("consolidation_facts_superseded_total");
export const factsContested = registry.createCounter("consolidation_facts_contested_total");
export const factsSkipped = registry.createCounter("consolidation_facts_skipped_total");

export const sweepLatency = registry.createHistogram("consolidation_sweep_latency_ms");
export const sweepMemoriesProcessed = registry.createCounter("consolidation_sweep_memories_total");

// Queue depth gauges
export const queueDepth = registry.createGauge("consolidation_queue_depth");
export const dlqDepth = registry.createGauge("consolidation_dlq_depth");

// DLQ / retry metrics
export const jobRetryTotal = registry.createCounter("consolidation_job_retry_total");
export const jobDlqTotal = registry.createCounter("consolidation_job_dlq_total");
export const jobPoisonTotal = registry.createCounter("consolidation_job_poison_total");
