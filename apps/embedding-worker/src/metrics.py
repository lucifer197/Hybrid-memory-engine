"""In-memory metrics for the embedding worker.

Mirrors the TypeScript MetricsRegistry pattern — counters and histograms
with a to_json() method for the /metrics HTTP endpoint.
"""

import json
import math
import threading
from typing import Any


class Counter:
    def __init__(self):
        self._lock = threading.Lock()
        self._value = 0

    def inc(self, delta: int = 1) -> None:
        with self._lock:
            self._value += delta

    def get(self) -> int:
        return self._value


class Histogram:
    MAX_OBSERVATIONS = 10_000

    def __init__(self):
        self._lock = threading.Lock()
        self._values: list[float] = []

    def observe(self, value: float) -> None:
        with self._lock:
            self._values.append(value)
            if len(self._values) > self.MAX_OBSERVATIONS:
                self._values = self._values[-self.MAX_OBSERVATIONS:]

    def snapshot(self) -> dict[str, float]:
        with self._lock:
            arr = sorted(self._values)
        if not arr:
            return {"count": 0, "sum": 0, "p50": 0, "p95": 0, "p99": 0, "min": 0, "max": 0}
        return {
            "count": len(arr),
            "sum": round(sum(arr), 2),
            "p50": _percentile(arr, 0.50),
            "p95": _percentile(arr, 0.95),
            "p99": _percentile(arr, 0.99),
            "min": arr[0],
            "max": arr[-1],
        }


class Gauge:
    def __init__(self):
        self._lock = threading.Lock()
        self._value: float = 0

    def set(self, value: float) -> None:
        with self._lock:
            self._value = value

    def get(self) -> float:
        return self._value


def _percentile(sorted_arr: list[float], p: float) -> float:
    idx = max(0, math.ceil(p * len(sorted_arr)) - 1)
    return round(sorted_arr[idx], 2)


class MetricsRegistry:
    def __init__(self):
        self._counters: dict[str, Counter] = {}
        self._gauges: dict[str, Gauge] = {}
        self._histograms: dict[str, Histogram] = {}

    def create_counter(self, name: str) -> Counter:
        c = Counter()
        self._counters[name] = c
        return c

    def create_gauge(self, name: str) -> Gauge:
        g = Gauge()
        self._gauges[name] = g
        return g

    def create_histogram(self, name: str) -> Histogram:
        h = Histogram()
        self._histograms[name] = h
        return h

    def to_json(self) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for name, c in self._counters.items():
            result[name] = c.get()
        for name, g in self._gauges.items():
            result[name] = g.get()
        for name, h in self._histograms.items():
            snap = h.snapshot()
            result[f"{name}_count"] = snap["count"]
            result[f"{name}_sum"] = snap["sum"]
            result[f"{name}_p50"] = snap["p50"]
            result[f"{name}_p95"] = snap["p95"]
            result[f"{name}_p99"] = snap["p99"]
        return result


# ── Singleton registry and metrics ─────────────────────────────

registry = MetricsRegistry()

embedding_jobs_total = registry.create_counter("embedding_jobs_total")
embedding_job_failures_total = registry.create_counter("embedding_job_failures_total")
embedding_latency_ms = registry.create_histogram("embedding_latency_ms")
embeddings_inserted_total = registry.create_counter("embeddings_inserted_total")
job_retry_total = registry.create_counter("embedding_job_retry_total")
job_dlq_total = registry.create_counter("embedding_job_dlq_total")
job_poison_total = registry.create_counter("embedding_job_poison_total")
queue_depth = registry.create_gauge("embedding_queue_depth")
dlq_depth = registry.create_gauge("embedding_dlq_depth")
