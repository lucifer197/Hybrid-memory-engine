import { MetricsRegistry } from "@hybrid-memory/observability";

export const registry = new MetricsRegistry();

export const contradictionsDetected = registry.createCounter("truth_contradictions_detected_total");
export const contradictionsResolved = registry.createCounter("truth_contradictions_resolved_total");
export const contradictionsSkipped = registry.createCounter("truth_contradictions_skipped_total");
export const staleFactsDowngraded = registry.createCounter("truth_stale_facts_downgraded_total");
export const staleFactsMarkedUnknown = registry.createCounter("truth_stale_facts_marked_unknown_total");
export const toolFactsPromoted = registry.createCounter("truth_tool_facts_promoted_total");

export const contradictionSweepLatency = registry.createHistogram("truth_contradiction_sweep_duration_ms");
export const staleSweepLatency = registry.createHistogram("truth_stale_sweep_duration_ms");
