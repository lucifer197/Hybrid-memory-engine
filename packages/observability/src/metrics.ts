export interface Counter {
  inc(labels?: Record<string, string>, delta?: number): void;
  get(labels?: Record<string, string>): number;
}

export interface Gauge {
  set(value: number, labels?: Record<string, string>): void;
  get(labels?: Record<string, string>): number;
}

export interface HistogramSnapshot {
  count: number;
  sum: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface Histogram {
  observe(value: number, labels?: Record<string, string>): void;
  snapshot(labels?: Record<string, string>): HistogramSnapshot;
}

/** Max observations per histogram series to bound memory. */
const MAX_OBSERVATIONS = 10_000;

/**
 * In-memory metrics registry.
 * Counters and histograms keyed by name + serialized labels.
 */
export class MetricsRegistry {
  private counters = new Map<string, Map<string, number>>();
  private gauges = new Map<string, Map<string, number>>();
  private histograms = new Map<string, Map<string, number[]>>();

  createGauge(name: string): Gauge {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, new Map());
    }
    const store = this.gauges.get(name)!;

    return {
      set: (value, labels = {}) => {
        store.set(labelsKey(labels), value);
      },
      get: (labels = {}) => store.get(labelsKey(labels)) ?? 0,
    };
  }

  createCounter(name: string): Counter {
    if (!this.counters.has(name)) {
      this.counters.set(name, new Map());
    }
    const store = this.counters.get(name)!;

    return {
      inc: (labels = {}, delta = 1) => {
        const key = labelsKey(labels);
        store.set(key, (store.get(key) ?? 0) + delta);
      },
      get: (labels = {}) => store.get(labelsKey(labels)) ?? 0,
    };
  }

  createHistogram(name: string): Histogram {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, new Map());
    }
    const store = this.histograms.get(name)!;

    return {
      observe: (value, labels = {}) => {
        const key = labelsKey(labels);
        if (!store.has(key)) store.set(key, []);
        const arr = store.get(key)!;
        arr.push(value);
        if (arr.length > MAX_OBSERVATIONS) {
          arr.splice(0, arr.length - MAX_OBSERVATIONS);
        }
      },
      snapshot: (labels = {}) => {
        const arr = store.get(labelsKey(labels)) ?? [];
        return computeSnapshot(arr);
      },
    };
  }

  /** Serialize all metrics as a flat JSON object for /metrics endpoint. */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [name, store] of this.counters) {
      for (const [key, value] of store) {
        result[key ? `${name}{${key}}` : name] = value;
      }
    }

    for (const [name, store] of this.gauges) {
      for (const [key, value] of store) {
        result[key ? `${name}{${key}}` : name] = value;
      }
    }

    for (const [name, store] of this.histograms) {
      for (const [key, arr] of store) {
        const prefix = key ? `${name}{${key}}` : name;
        const snap = computeSnapshot(arr);
        result[`${prefix}_count`] = snap.count;
        result[`${prefix}_sum`] = round(snap.sum);
        result[`${prefix}_p50`] = round(snap.p50);
        result[`${prefix}_p95`] = round(snap.p95);
        result[`${prefix}_p99`] = round(snap.p99);
      }
    }

    return result;
  }

  /** Reset all metrics (for testing). */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

function labelsKey(labels: Record<string, string>): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}="${labels[k]}"`).join(",");
}

function computeSnapshot(arr: number[]): HistogramSnapshot {
  if (arr.length === 0) {
    return { count: 0, sum: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }
  const sorted = [...arr].sort((a, b) => a - b);
  return {
    count: sorted.length,
    sum: sorted.reduce((s, v) => s + v, 0),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function round(n: number): number {
  return parseFloat(n.toFixed(2));
}
