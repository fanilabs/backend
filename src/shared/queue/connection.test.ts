import { afterEach, describe, expect, it, vi } from 'vitest';

const quit = vi.fn().mockResolvedValue(undefined);
const on = vi.fn();

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ quit, on })),
}));

describe('queue connection singleton', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reconnects after disconnectQueueConnection instead of returning the closed connection', async () => {
    const { getQueueConnection, disconnectQueueConnection } = await import('./connection.js');
    const { Redis } = await import('ioredis');

    const first = getQueueConnection();
    expect(getQueueConnection()).toBe(first);
    expect(Redis).toHaveBeenCalledTimes(1);

    await disconnectQueueConnection();
    expect(quit).toHaveBeenCalledTimes(1);

    const second = getQueueConnection();
    expect(Redis).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it('is a no-op when disconnecting without an active connection', async () => {
    const { disconnectQueueConnection } = await import('./connection.js');
    await expect(disconnectQueueConnection()).resolves.toBeUndefined();
    expect(quit).not.toHaveBeenCalled();
  });
});
