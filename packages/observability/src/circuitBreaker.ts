export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Name for logging/metrics. */
  name: string;
  /** Number of consecutive failures before opening. Default 5. */
  failureThreshold?: number;
  /** How long to stay open before allowing a probe (ms). Default 30_000. */
  resetTimeoutMs?: number;
  /** Optional callback when state changes. */
  onStateChange?: (
    name: string,
    from: CircuitState,
    to: CircuitState
  ) => void;
}

/**
 * Error thrown when the circuit breaker is open and not accepting requests.
 */
export class CircuitBreakerOpenError extends Error {
  public readonly breakerName: string;

  constructor(name: string) {
    super(`Circuit breaker "${name}" is open`);
    this.name = "CircuitBreakerOpenError";
    this.breakerName = name;
  }
}

/**
 * In-process circuit breaker with closed/open/half-open states.
 *
 * - **Closed**: requests pass through normally; consecutive failures are counted.
 * - **Open**: requests are rejected immediately with CircuitBreakerOpenError.
 *   After `resetTimeoutMs`, transitions to half-open.
 * - **Half-open**: one probe request is allowed. Success → closed; failure → open.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failureCount = 0;
  private lastFailureTime = 0;

  private readonly _name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange?: (
    name: string,
    from: CircuitState,
    to: CircuitState
  ) => void;

  constructor(opts: CircuitBreakerOptions) {
    this._name = opts.name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.onStateChange = opts.onStateChange;
  }

  getState(): CircuitState {
    return this.state;
  }

  getName(): string {
    return this._name;
  }

  /**
   * Execute `fn` through the breaker.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.transition("half-open");
      } else {
        throw new CircuitBreakerOpenError(this._name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    if (this.state !== "closed") {
      this.transition("closed");
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      this.transition("open");
    } else if (this.failureCount >= this.failureThreshold) {
      this.transition("open");
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    this.state = to;
    this.onStateChange?.(this._name, from, to);
  }

  /** Reset for testing. */
  reset(): void {
    this.state = "closed";
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }
}
