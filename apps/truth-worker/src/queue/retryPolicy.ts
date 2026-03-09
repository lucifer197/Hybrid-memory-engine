import type { RetryPolicyOptions } from "@hybrid-memory/observability";

export function getRetryPolicy(): RetryPolicyOptions {
  return {
    maxAttempts: 3,
    baseDelayMs: 2_000,
    maxDelayMs: 60_000,
  };
}
