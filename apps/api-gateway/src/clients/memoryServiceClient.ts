import type {
  WriteTurnRequest,
  WriteTurnResponse,
  ForgetRequest,
  ForgetResponse,
  ErrorResponse,
} from "@hybrid-memory/shared-types";
import {
  getTraceId,
  withRetry,
  CircuitBreaker,
  createLogger,
} from "@hybrid-memory/observability";

const log = createLogger("api-gateway", "memoryServiceClient");

const MEMORY_SERVICE_URL =
  process.env.MEMORY_SERVICE_URL ?? "http://localhost:3001";
const MEMORY_SERVICE_TIMEOUT_MS = parseInt(
  process.env.MEMORY_SERVICE_TIMEOUT_MS ?? "15000",
  10
);

const breaker = new CircuitBreaker({
  name: "memory_service",
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  onStateChange: (name, from, to) => {
    log.warn("circuit_breaker_transition", { breaker: name, from, to });
  },
});

export interface MemoryServiceResult {
  status: number;
  body: WriteTurnResponse | ForgetResponse | ErrorResponse;
  traceId?: string;
}

/**
 * Forward a write-turn request to the internal memory-service.
 */
export async function writeTurn(
  payload: WriteTurnRequest,
  traceId?: string
): Promise<MemoryServiceResult> {
  const effectiveTraceId = traceId ?? getTraceId();

  return breaker.execute(() =>
    withRetry(
      async () => {
        const res = await fetch(`${MEMORY_SERVICE_URL}/internal/memory/turn`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": effectiveTraceId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(MEMORY_SERVICE_TIMEOUT_MS),
        });

        if (res.status >= 500) {
          throw new Error(`memory-service returned ${res.status}`);
        }

        const body = (await res.json()) as WriteTurnResponse | ErrorResponse;
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
    )
  );
}

/**
 * Forward a forget request to the internal memory-service.
 */
export async function forgetMemory(
  payload: ForgetRequest,
  traceId?: string
): Promise<MemoryServiceResult> {
  const effectiveTraceId = traceId ?? getTraceId();

  return breaker.execute(() =>
    withRetry(
      async () => {
        const res = await fetch(`${MEMORY_SERVICE_URL}/internal/memory/forget`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Trace-Id": effectiveTraceId,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(MEMORY_SERVICE_TIMEOUT_MS),
        });

        if (res.status >= 500) {
          throw new Error(`memory-service returned ${res.status}`);
        }

        const body = (await res.json()) as ForgetResponse | ErrorResponse;
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
    )
  );
}
