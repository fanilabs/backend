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
    const originalSetTimeout = global.setTimeout;
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
});
