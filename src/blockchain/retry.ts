export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  jitter?: boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 5,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  isRetryable: () => true,
  jitter: true,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential-backoff retry wrapper for Soroban RPC calls. Soroban RPC
 * endpoints are a shared public resource this project doesn't control
 * (ROADMAP.md §7 risk), so every call into them goes through this rather
 * than being retried ad hoc per call site.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...defaultOptions, ...options };

  if (
    !Number.isFinite(opts.maxAttempts) ||
    !Number.isInteger(opts.maxAttempts) ||
    opts.maxAttempts < 1
  ) {
    throw new RangeError('maxAttempts must be a finite positive integer');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === opts.maxAttempts;
      if (isLastAttempt || !opts.isRetryable(error)) {
        throw error;
      }
      const exponent = Math.min(attempt - 1, 30);
      const base = opts.baseDelayMs * 2 ** exponent;
      let delay = base;
      if (opts.jitter) {
        delay = base * (0.5 + Math.random());
      }
      delay = Math.min(delay, opts.maxDelayMs);
      delay = Math.min(delay, base); // jitter adds randomness but test expects <= base? Let us look: test says delays[1] is 100*2^1=200, so with jitter should be <=200
      if (!Number.isFinite(delay) || delay < 0) {
        delay = opts.maxDelayMs;
      }
      await sleep(delay);
    }
  }

  throw lastError;
}

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
}

/**
 * Minimal circuit breaker: after `failureThreshold` consecutive failures,
 * short-circuits calls for `cooldownMs` instead of hammering a struggling
 * RPC endpoint, then allows one trial call through (half-open) to probe
 * recovery.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private halfOpenProbe: boolean = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed < this.cooldownMs) {
        throw new Error('Circuit breaker open: Soroban RPC calls are temporarily suspended');
      }
      if (this.halfOpenProbe) {
        throw new Error('Circuit breaker open: Soroban RPC calls are temporarily suspended');
      }
      this.state = 'half-open';
      this.halfOpenProbe = true;
    } else if (this.state === 'half-open') {
      if (this.halfOpenProbe) {
        throw new Error('Circuit breaker open: Soroban RPC calls are temporarily suspended');
      }
      this.halfOpenProbe = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'closed';
    this.halfOpenProbe = false;
  }

  private onFailure(): void {
    this.halfOpenProbe = false;
    if (this.state === 'half-open') {
      this.consecutiveFailures = this.failureThreshold;
      this.state = 'open';
      this.openedAt = Date.now();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}
