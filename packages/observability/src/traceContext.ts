import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface TraceStore {
  traceId: string;
  service: string;
  /** Arbitrary key-value pairs (tenant_id, memory_id, etc.) */
  attributes: Record<string, string>;
}

const als = new AsyncLocalStorage<TraceStore>();

/** Get the current trace context (or undefined outside a context). */
export function getTraceContext(): TraceStore | undefined {
  return als.getStore();
}

/** Get trace_id from current context, or generate a new one. */
export function getTraceId(): string {
  return als.getStore()?.traceId ?? randomUUID();
}

/**
 * Run `fn` within a trace context.
 * Used by Express middleware and queue consumers.
 */
export function runWithTrace<T>(store: TraceStore, fn: () => T): T {
  return als.run(store, fn);
}

/**
 * Run async `fn` within a trace context.
 *
 * Overload 1: pass a full TraceStore.
 * Overload 2: pass a service name + fn + optional traceId (convenience for queue consumers).
 */
export function runWithTraceAsync<T>(
  storeOrService: TraceStore | string,
  fn: () => Promise<T>,
  traceId?: string
): Promise<T> {
  const store: TraceStore =
    typeof storeOrService === "string"
      ? { traceId: traceId ?? randomUUID(), service: storeOrService, attributes: {} }
      : storeOrService;
  return als.run(store, fn);
}

/**
 * Set an attribute on the current trace context.
 * No-op if outside a context.
 */
export function setTraceAttribute(key: string, value: string): void {
  const store = als.getStore();
  if (store) store.attributes[key] = value;
}
