import type { RetryPolicyOptions } from "@hybrid-memory/observability";
import { getEnv } from "../config/env";

export function getRetryPolicy(): RetryPolicyOptions {
  return {
    maxAttempts: getEnv().JOB_MAX_ATTEMPTS,
    baseDelayMs: 1_000,
    maxDelayMs: 30_000,
  };
}
