import type { ErrorResponse } from "@hybrid-memory/shared-types";
import { getTraceId, withRetry } from "@hybrid-memory/observability";

const MEMORY_SERVICE_URL =
  process.env.MEMORY_SERVICE_URL ?? "http://localhost:3001";
const MEMORY_SERVICE_TIMEOUT_MS = parseInt(
  process.env.MEMORY_SERVICE_TIMEOUT_MS ?? "15000",
  10
);

export interface FactsClientResult {
  status: number;
  body: Record<string, unknown> | ErrorResponse;
  traceId?: string;
}

/**
 * Forward a GET /facts request to memory-service.
 */
export async function listFacts(
  query: Record<string, string>,
  traceId?: string
): Promise<FactsClientResult> {
  const effectiveTraceId = traceId ?? getTraceId();
  const qs = new URLSearchParams(query).toString();

  return withRetry(
    async () => {
      const res = await fetch(
        `${MEMORY_SERVICE_URL}/internal/facts?${qs}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": effectiveTraceId,
          },
          signal: AbortSignal.timeout(MEMORY_SERVICE_TIMEOUT_MS),
        }
      );

      const body = (await res.json()) as Record<string, unknown> | ErrorResponse;
      return {
        status: res.status,
        body,
        traceId: res.headers.get("X-Trace-Id") ?? undefined,
      };
    },
    {
      maxAttempts: 2,
      baseDelayMs: 500,
      shouldRetry: (err: unknown) => err instanceof TypeError,
    }
  );
}

/**
 * Forward a POST /facts/confirm request to memory-service.
 */
export async function confirmFact(
  payload: Record<string, unknown>,
  traceId?: string
): Promise<FactsClientResult> {
  const effectiveTraceId = traceId ?? getTraceId();

  return withRetry(
    async () => {
      const res = await fetch(
        `${MEMORY_SERVICE_URL}/internal/facts/confirm`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": effectiveTraceId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(MEMORY_SERVICE_TIMEOUT_MS),
        }
      );

      const body = (await res.json()) as Record<string, unknown> | ErrorResponse;
      return {
        status: res.status,
        body,
        traceId: res.headers.get("X-Trace-Id") ?? undefined,
      };
    },
    {
      maxAttempts: 2,
      baseDelayMs: 500,
      shouldRetry: (err: unknown) => err instanceof TypeError,
    }
  );
}

/**
 * Forward a POST /facts/reject request to memory-service.
 */
export async function rejectFact(
  payload: Record<string, unknown>,
  traceId?: string
): Promise<FactsClientResult> {
  const effectiveTraceId = traceId ?? getTraceId();

  return withRetry(
    async () => {
      const res = await fetch(
        `${MEMORY_SERVICE_URL}/internal/facts/reject`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": effectiveTraceId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(MEMORY_SERVICE_TIMEOUT_MS),
        }
      );

      const body = (await res.json()) as Record<string, unknown> | ErrorResponse;
      return {
        status: res.status,
        body,
        traceId: res.headers.get("X-Trace-Id") ?? undefined,
      };
    },
    {
      maxAttempts: 2,
      baseDelayMs: 500,
      shouldRetry: (err: unknown) => err instanceof TypeError,
    }
  );
}

/**
 * Forward a POST /facts/correct request to memory-service.
 */
export async function correctFact(
  payload: Record<string, unknown>,
  traceId?: string
): Promise<FactsClientResult> {
  const effectiveTraceId = traceId ?? getTraceId();

  return withRetry(
    async () => {
      const res = await fetch(
        `${MEMORY_SERVICE_URL}/internal/facts/correct`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": effectiveTraceId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(MEMORY_SERVICE_TIMEOUT_MS),
        }
      );

      const body = (await res.json()) as Record<string, unknown> | ErrorResponse;
      return {
        status: res.status,
        body,
        traceId: res.headers.get("X-Trace-Id") ?? undefined,
      };
    },
    {
      maxAttempts: 2,
      baseDelayMs: 500,
      shouldRetry: (err: unknown) => err instanceof TypeError,
    }
  );
}
