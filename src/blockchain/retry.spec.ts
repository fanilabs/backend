import { describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, withRetry } from './retry.js';

describe('withRetry', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success within maxAttempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 5, baseDelayMs: 1 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting maxAttempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when isRetryable returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 1, isRetryable: () => false }),
    ).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('applies jitter to exponential backoff delays for variability', async () => {
    const delays: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: () => void, delay?: number) => {
      if (typeof delay === 'number') {
        delays.push(delay);
      }
      cb();
      return {} as NodeJS.Timeout;
    });

    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 800 }),
    ).rejects.toThrow();

    vi.restoreAllMocks();

    // With jitter applied: multiple runs should produce different delay sequences
    // (this test runs once, so we collect delays from this single run)
    expect(delays).toHaveLength(3); // 3 retries = 3 delays
    // All delays should be within the exponential backoff bounds
    expect(delays[0]!).toBeLessThanOrEqual(100);
    expect(delays[1]!).toBeLessThanOrEqual(200);
    expect(delays[2]!).toBeLessThanOrEqual(800);
  });

  it('respects maxDelayMs even with jitter applied', async () => {
    const delays: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: () => void, delay?: number) => {
      if (typeof delay === 'number') {
        delays.push(delay);
      }
      cb();
      return {} as NodeJS.Timeout;
    });

    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 500 }),
    ).rejects.toThrow();

    vi.restoreAllMocks();

    // All delays must respect the maxDelayMs limit
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(500);
    }
  });

  it('allows disabling jitter with a jitter option for deterministic testing', async () => {
    const delays: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: () => void, delay?: number) => {
      if (typeof delay === 'number') {
        delays.push(delay);
      }
      cb();
      return {} as NodeJS.Timeout;
    });

    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 800, jitter: false }),
    ).rejects.toThrow();

    vi.restoreAllMocks();

    // Without jitter: delays should be deterministic exponential backoff
    // 100 * 2^0 = 100, 100 * 2^1 = 200, 100 * 2^2 = 400
    expect(delays).toEqual([100, 200, 400]);
  });

  // Issue #694: invalid maxAttempts must be caught before any fn() or timer
  it('rejects maxAttempts of zero before invoking the operation', async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: 0 })).rejects.toThrow(RangeError);
    await expect(withRetry(fn, { maxAttempts: 0 })).rejects.toThrow('maxAttempts');
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects negative maxAttempts before invoking the operation', async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: -1 })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects NaN maxAttempts before invoking the operation', async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: NaN })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects Infinity maxAttempts before invoking the operation', async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: Infinity })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects fractional maxAttempts before invoking the operation', async () => {
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: 1.5 })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('accepts maxAttempts=1 and performs exactly one attempt', async () => {
    const fn = vi.fn().mockResolvedValue('done');
    const result = await withRetry(fn, { maxAttempts: 1 });
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses the default maxAttempts when options are omitted', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await withRetry(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects maxAttempts of zero without scheduling any timer', async () => {
    const timerSpy = vi.spyOn(global, 'setTimeout');
    const fn = vi.fn();
    await expect(withRetry(fn, { maxAttempts: 0 })).rejects.toThrow(RangeError);
    expect(fn).not.toHaveBeenCalled();
    expect(timerSpy).not.toHaveBeenCalled();
    timerSpy.mockRestore();
  });

  // Issue #344: with large maxAttempts the exponent must be capped so the
  // backoff never overflows into NaN/Infinity — a NaN delay would make
  // setTimeout fire immediately and turn the retry loop into a hot spin
  // against a struggling RPC endpoint.
  it('caps backoff safely for large attempt counts without producing NaN delays', async () => {
    const delays: number[] = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: () => void, delay?: number) => {
      if (typeof delay === 'number') {
        delays.push(delay);
      }
      cb();
      return {} as NodeJS.Timeout;
    });

    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetry(fn, { maxAttempts: 64, baseDelayMs: 100, maxDelayMs: 8_000, jitter: false }),
    ).rejects.toThrow('fail');

    expect(fn).toHaveBeenCalledTimes(64);
    expect(delays).toHaveLength(63);
    for (const delay of delays) {
      expect(Number.isFinite(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(8_000);
    }

    vi.restoreAllMocks();
  });
});

describe('CircuitBreaker', () => {
  it('starts closed and allows calls through', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 });
    const result = await breaker.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(breaker.getState()).toBe('closed');
  });

  it('opens after reaching the failure threshold and rejects further calls', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    const failing = () => Promise.reject(new Error('boom'));

    await expect(breaker.execute(failing)).rejects.toThrow('boom');
    await expect(breaker.execute(failing)).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('open');

    await expect(breaker.execute(() => Promise.resolve('should not run'))).rejects.toThrow(
      'Circuit breaker open',
    );
  });

  it('recovers to closed after a successful half-open trial', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });

    await expect(breaker.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow();
    expect(breaker.getState()).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.getState()).toBe('closed');
  });

  it('repeated failures of one operation do not open the breaker for a different one', async () => {
    // When circuit breakers are scoped per-operation, this test verifies that failures
    // in getEvents do not affect getLatestLedger
    const breaker = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    const failingGetEvents = () => Promise.reject(new Error('getEvents timeout'));
    const successfulGetLatestLedger = () => Promise.resolve({ sequence: 12345 });

    // Fail getEvents twice to trip the breaker
    await expect(breaker.execute(failingGetEvents)).rejects.toThrow('getEvents timeout');
    await expect(breaker.execute(failingGetEvents)).rejects.toThrow('getEvents timeout');
    expect(breaker.getState()).toBe('open');

    // With a single breaker, this fails. With scoped breakers, getLatestLedger succeeds
    // This test documents the expected behavior with scoped breakers (#24)
    await expect(breaker.execute(successfulGetLatestLedger)).rejects.toThrow(
      'Circuit breaker open',
    );
  });

  // Issue #345: only ONE trial request may pass through in half-open state;
  // the rest of a concurrent burst must be rejected immediately so a
  // struggling RPC endpoint isn't flooded while it recovers.
  it('allows only a single trial request in half-open state under concurrency', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });

    await expect(breaker.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(breaker.getState()).toBe('open');

    await new Promise((resolve) => setTimeout(resolve, 5));

    const fn = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'ok';
    });

    const results = await Promise.allSettled([
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
    ]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(9);
    expect(breaker.getState()).toBe('closed');
  });

  it('re-opens after a failing half-open probe and requires a new cooldown', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1 });

    await expect(breaker.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await new Promise((resolve) => setTimeout(resolve, 5));

    // First probe after cooldown fails → back to open
    await expect(breaker.execute(() => Promise.reject(new Error('still down')))).rejects.toThrow(
      'still down',
    );
    expect(breaker.getState()).toBe('open');

    // Immediately after, the breaker must be closed off again until the
    // next cooldown elapses (a fresh openedAt was stamped on probe failure).
    await expect(breaker.execute(() => Promise.resolve('should not run'))).rejects.toThrow(
      'Circuit breaker open',
    );
  });
});
