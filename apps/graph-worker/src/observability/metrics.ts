import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

export const graphJobSuccess = registry.createCounter("graph_job_success_total");
export const graphJobFailure = registry.createCounter("graph_job_failure_total");
export const graphJobLatency = registry.createHistogram("graph_job_latency_ms");

// Queue depth gauges
export const queueDepth = registry.createGauge("graph_queue_depth");
export const dlqDepth = registry.createGauge("graph_dlq_depth");

// DLQ / retry metrics
export const jobRetryTotal = registry.createCounter("graph_job_retry_total");
export const jobDlqTotal = registry.createCounter("graph_job_dlq_total");
export const jobPoisonTotal = registry.createCounter("graph_job_poison_total");
