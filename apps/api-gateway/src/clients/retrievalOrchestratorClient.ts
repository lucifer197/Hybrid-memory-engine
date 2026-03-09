import type {
  RetrieveContextRequest,
  RetrieveContextResponse,
  ErrorResponse,
} from "@hybrid-memory/shared-types";
import {
  getTraceId,
  withRetry,
  CircuitBreaker,
  createLogger,
} from "@hybrid-memory/observability";

const log = createLogger("api-gateway", "retrievalOrchestratorClient");

const RETRIEVAL_URL =
  process.env.RETRIEVAL_ORCHESTRATOR_URL ?? "http://localhost:3002";
const RETRIEVAL_TIMEOUT_MS = parseInt(
  process.env.RETRIEVAL_TIMEOUT_MS ?? "12000",
  10
);

const breaker = new CircuitBreaker({
  name: "retrieval_orchestrator",
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  onStateChange: (name, from, to) => {
    log.warn("circuit_breaker_transition", { breaker: name, from, to });
  },
});

export interface RetrievalResult {
  status: number;
  body: RetrieveContextResponse | ErrorResponse;
  traceId?: string;
}

export async function retrieveContext(
  payload: RetrieveContextRequest,
  traceId?: string
): Promise<RetrievalResult> {
  const effectiveTraceId = traceId ?? getTraceId();

  return breaker.execute(() =>
    withRetry(
      async () => {
        const res = await fetch(
          `${RETRIEVAL_URL}/internal/memory/retrieve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Trace-Id": effectiveTraceId,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(RETRIEVAL_TIMEOUT_MS),
          }
        );

        if (res.status >= 500) {
          throw new Error(`retrieval-orchestrator returned ${res.status}`);
        }

        const body = (await res.json()) as
          | RetrieveContextResponse
          | ErrorResponse;
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
