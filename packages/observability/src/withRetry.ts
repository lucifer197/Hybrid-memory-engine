export interface RetryOptions {
  /** Max attempts (including first). Default 3. */
  maxAttempts?: number;
  /** Base delay in ms. Default 500. */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default 10_000. */
  maxDelayMs?: number;
  /** Jitter factor 0..1. Default 0.3 (30% jitter). */
  jitter?: number;
  /** Predicate: return true to retry, false to bail. Default: retry everything. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Optional callback after each failed attempt (for logging/metrics). */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Retry an async operation with exponential backoff + jitter.
 *
 * Calls `fn` up to `maxAttempts` times. On failure, applies exponential
 * backoff (baseDelay * 2^(attempt-1)) with random jitter, capped at maxDelay.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 10_000;
  const jitter = opts.jitter ?? 0.3;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const onRetry = opts.onRetry;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }

      const exponential = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1),
        maxDelayMs
      );
      const jittered =
        exponential * (1 - jitter + Math.random() * jitter * 2);
      const delay = Math.round(Math.min(jittered, maxDelayMs));

      onRetry?.(err, attempt, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
