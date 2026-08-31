import { afterEach, describe, expect, it, vi } from 'vitest';

const $disconnect = vi.fn().mockResolvedValue(undefined);

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn().mockImplementation(() => ({ $disconnect })),
}));

describe('prisma client singleton', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reconnects after disconnectPrisma instead of returning the closed client', async () => {
    const { getPrismaClient, disconnectPrisma } = await import('./prisma-client.js');
    const { PrismaClient } = await import('@prisma/client');

    const first = getPrismaClient();
    expect(getPrismaClient()).toBe(first);
    expect(PrismaClient).toHaveBeenCalledTimes(1);

    await disconnectPrisma();
    expect($disconnect).toHaveBeenCalledTimes(1);

    const second = getPrismaClient();
    expect(PrismaClient).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it('is a no-op when disconnecting without an active client', async () => {
    const { disconnectPrisma } = await import('./prisma-client.js');
    await expect(disconnectPrisma()).resolves.toBeUndefined();
    expect($disconnect).not.toHaveBeenCalled();
  });
});
