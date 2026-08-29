import { afterEach, describe, expect, it, vi } from 'vitest';

const quit = vi.fn().mockResolvedValue(undefined);
const on = vi.fn();

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ quit, on })),
}));

describe('redis-client singleton', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reconnects after disconnectRedis instead of returning the closed client', async () => {
    const { getRedisClient, disconnectRedis } = await import('./redis-client.js');
    const { Redis } = await import('ioredis');

    const first = getRedisClient();
    expect(getRedisClient()).toBe(first);
    expect(Redis).toHaveBeenCalledTimes(1);

    await disconnectRedis();
    expect(quit).toHaveBeenCalledTimes(1);

    const second = getRedisClient();
    expect(Redis).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it('is a no-op when disconnecting without an active client', async () => {
    const { disconnectRedis } = await import('./redis-client.js');
    await expect(disconnectRedis()).resolves.toBeUndefined();
    expect(quit).not.toHaveBeenCalled();
  });
});
