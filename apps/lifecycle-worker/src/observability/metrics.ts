import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

// Queue job metrics
export const accessJobLatency = registry.createHistogram("access_job_latency_ms");
export const reinforceJobLatency = registry.createHistogram("reinforce_job_latency_ms");

// Sweep metrics
export const decayProcessed = registry.createCounter("decay_processed_total");
export const archivedCount = registry.createCounter("archived_total");
export const consolidatedCount = registry.createCounter("consolidated_total");
export const decaySweepLatency = registry.createHistogram("decay_sweep_latency_ms");
export const archiveSweepLatency = registry.createHistogram("archive_sweep_latency_ms");
export const consolidateSweepLatency = registry.createHistogram("consolidate_sweep_latency_ms");

// Retention sweep metrics
export const retentionDeletedCount = registry.createCounter("retention_deleted_total");
export const retentionSweepLatency = registry.createHistogram("retention_sweep_latency_ms");

// Queue depth gauges
export const queueDepth = registry.createGauge("lifecycle_queue_depth");
export const dlqDepth = registry.createGauge("lifecycle_dlq_depth");

// DLQ / retry metrics
export const jobRetryTotal = registry.createCounter("lifecycle_job_retry_total");
export const jobDlqTotal = registry.createCounter("lifecycle_job_dlq_total");
export const jobPoisonTotal = registry.createCounter("lifecycle_job_poison_total");
