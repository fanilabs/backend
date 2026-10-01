import { describe, expect, it, vi } from 'vitest';
import {
  BACKLOG,
  DISCONNECT_TIMEOUT_MS,
  SHUTDOWN_TIMEOUT_MS,
  executeShutdownSteps,
  withTimeout,
} from '../src/server.js';

describe('server configuration and shutdown', () => {
  it('defines the standard backlog limit of 511', () => {
    expect(BACKLOG).toBe(511);
  });

  it('defines shutdown timeout constants', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(10_000);
    expect(DISCONNECT_TIMEOUT_MS).toBe(3_000);
  });

  describe('executeShutdownSteps', () => {
    it('executes all teardown steps sequentially when all succeed', async () => {
      const callOrder: string[] = [];

      const deps = {
        app: {
          close: vi.fn().mockImplementation(async () => {
            callOrder.push('app.close');
          }),
        },
        closeAllQueues: vi.fn().mockImplementation(async () => {
          callOrder.push('closeAllQueues');
        }),
        disconnectPrisma: vi.fn().mockImplementation(async () => {
          callOrder.push('disconnectPrisma');
        }),
        disconnectRedis: vi.fn().mockImplementation(async () => {
          callOrder.push('disconnectRedis');
        }),
        disconnectQueueConnection: vi.fn().mockImplementation(async () => {
          callOrder.push('disconnectQueueConnection');
        }),
      };

      const errors = await executeShutdownSteps(deps);

      expect(errors).toHaveLength(0);
      expect(callOrder).toEqual([
        'app.close',
        'closeAllQueues',
        'disconnectPrisma',
        'disconnectRedis',
        'disconnectQueueConnection',
      ]);
    });

    it('ensures all systems attempt to disconnect even if earlier disconnections fail', async () => {
      const deps = {
        app: { close: vi.fn().mockResolvedValue(undefined) },
        closeAllQueues: vi.fn().mockResolvedValue(undefined),
        disconnectPrisma: vi.fn().mockRejectedValue(new Error('Prisma disconnect failed')),
        disconnectRedis: vi.fn().mockResolvedValue(undefined),
        disconnectQueueConnection: vi.fn().mockRejectedValue(new Error('Queue disconnect failed')),
      };

      const errors = await executeShutdownSteps(deps);

      expect(errors).toHaveLength(2);
      expect((errors[0] as Error).message).toBe('Prisma disconnect failed');
      expect((errors[1] as Error).message).toBe('Queue disconnect failed');
      expect(deps.disconnectRedis).toHaveBeenCalledTimes(1);
      expect(deps.disconnectQueueConnection).toHaveBeenCalledTimes(1);
    });

    it('times out hanging disconnections without abandoning subsequent disconnections', async () => {
      const deps = {
        app: { close: vi.fn().mockResolvedValue(undefined) },
        closeAllQueues: vi.fn().mockResolvedValue(undefined),
        disconnectPrisma: vi.fn().mockImplementation(() => new Promise(() => {})),
        disconnectRedis: vi.fn().mockResolvedValue(undefined),
        disconnectQueueConnection: vi.fn().mockResolvedValue(undefined),
        disconnectTimeoutMs: 50,
      };

      const errors = await executeShutdownSteps(deps);

      expect(errors).toHaveLength(1);
      expect((errors[0] as Error).message).toContain('Prisma disconnect timed out');
      expect(deps.disconnectRedis).toHaveBeenCalledTimes(1);
      expect(deps.disconnectQueueConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('withTimeout', () => {
    it('resolves when inner promise resolves before timeout', async () => {
      const result = await withTimeout(async () => 'ok', 500, 'Test');
      expect(result).toBe('ok');
    });

    it('rejects when inner promise hangs beyond timeout', async () => {
      await expect(withTimeout(() => new Promise(() => {}), 50, 'Database')).rejects.toThrow(
        'Database disconnect timed out after 50ms',
      );
    });
  });
});
