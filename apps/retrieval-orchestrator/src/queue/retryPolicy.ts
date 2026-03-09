import type { RetryPolicyOptions } from "@hybrid-memory/observability";

export function getRetryPolicy(): RetryPolicyOptions {
  return {
    maxAttempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  };
}
