import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

export const httpRequestLatency = registry.createHistogram("http_request_latency_ms");
export const httpRequestCount = registry.createCounter("http_request_total");
