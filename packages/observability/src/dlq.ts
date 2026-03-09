/**
 * Retry metadata attached to job payloads via _-prefixed fields.
 * Backward compatible — existing payloads without these fields
 * are treated as attempt_count=0.
 */
export interface RetryMeta {
  attempt_count: number;
  last_failed_at?: string;
  last_error?: string;
  last_stack?: string;
}

/**
 * Extract retry metadata from a job payload.
 * Returns defaults if the fields are missing (backward compat).
 */
export function getRetryMeta(
  job: Record<string, unknown>
): RetryMeta {
  return {
    attempt_count:
      typeof job._attempt_count === "number" ? job._attempt_count : 0,
    last_failed_at:
      typeof job._last_failed_at === "string"
        ? job._last_failed_at
        : undefined,
    last_error:
      typeof job._last_error === "string" ? job._last_error : undefined,
    last_stack:
      typeof job._last_stack === "string" ? job._last_stack : undefined,
  };
}

/**
 * Stamp retry metadata onto a job payload (mutates).
 * Captures stack trace for debuggability.
 * Returns the mutated job for chaining.
 */
export function stampRetryMeta(
  job: Record<string, unknown>,
  error: unknown
): Record<string, unknown> {
  const meta = getRetryMeta(job);
  job._attempt_count = meta.attempt_count + 1;
  job._last_failed_at = new Date().toISOString();
  job._last_error =
    error instanceof Error ? error.message : String(error);
  job._last_stack =
    error instanceof Error ? (error.stack ?? "") : "";
  return job;
}

/**
 * Decide whether to retry or dead-letter a failed job.
 * Returns "retry" if under max attempts, "dlq" if exhausted.
 */
export function retryOrDlq(
  job: Record<string, unknown>,
  maxAttempts: number
): "retry" | "dlq" {
  const meta = getRetryMeta(job);
  return meta.attempt_count >= maxAttempts ? "dlq" : "retry";
}

// ── Retry policy with exponential backoff ─────────────────────

export interface RetryPolicyOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_POLICY: RetryPolicyOptions = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

/**
 * Calculate the exponential backoff delay for a given attempt number.
 * Uses full-jitter: uniform random in [0, min(maxDelay, base * 2^attempt)].
 */
export function computeBackoffMs(
  attempt: number,
  opts: RetryPolicyOptions = DEFAULT_RETRY_POLICY
): number {
  const expDelay = Math.min(
    opts.maxDelayMs,
    opts.baseDelayMs * Math.pow(2, attempt)
  );
  return Math.floor(Math.random() * expDelay);
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Structured dead-letter entry ──────────────────────────────

export interface DeadLetterEntry {
  job_type: string;
  queue_name: string;
  payload: Record<string, unknown>;
  error_message: string;
  stack_trace: string;
  attempt_count: number;
  created_at: string;
}

/**
 * Build a structured DLQ entry from a failed job.
 */
export function buildDeadLetterEntry(
  jobType: string,
  queueName: string,
  job: Record<string, unknown>,
  error: unknown
): DeadLetterEntry {
  const meta = getRetryMeta(job);
  return {
    job_type: jobType,
    queue_name: queueName,
    payload: job,
    error_message: error instanceof Error ? error.message : String(error),
    stack_trace: error instanceof Error ? (error.stack ?? "") : "",
    attempt_count: meta.attempt_count,
    created_at: new Date().toISOString(),
  };
}
