import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves with the original value on success and clears the timer', async () => {
    const value = { id: 'result' };
    const callback = vi.fn().mockResolvedValue(value);

    const result = await withTimeout(callback, 1_000);

    expect(result).toBe(value);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the original error on async rejection and clears the timer', async () => {
    const error = new Error('async failure');
    const callback = vi.fn().mockRejectedValue(error);

    await expect(withTimeout(callback, 1_000)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces a synchronous callback throw as a rejection preserving the error', async () => {
    const error = new Error('sync failure');
    const callback = vi.fn(() => {
      throw error;
    });

    await expect(withTimeout(callback, 1_000)).rejects.toBe(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at the deadline when the callback never settles and clears the timer', async () => {
    const callback = vi.fn(() => new Promise<never>(() => {}));

    const pending = withTimeout(callback, 1_000);
    const assertion = expect(pending).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create an unhandled rejection when the callback rejects after the timeout', async () => {
    let rejectLate: (reason: unknown) => void = () => {};
    const callback = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectLate = reject;
        }),
    );

    const pending = withTimeout(callback, 1_000);
    const assertion = expect(pending).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;

    rejectLate(new Error('late failure'));
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
  });
});
