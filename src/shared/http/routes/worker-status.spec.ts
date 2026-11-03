import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import healthRoutes from './health.js';
import * as queue from '../../queue/index.js';
import { workerExecutionStatus } from '../../queue/worker-execution.js';

afterEach(() => vi.restoreAllMocks());

it.each(['empty', 'stalled', 'unreachable'] as const)(
  'exposes blocked execution with %s queues without masking queue failures',
  async (state) => {
    const lookup = vi.spyOn(queue, 'getQueueHealth');
    if (state === 'unreachable') lookup.mockRejectedValue(new Error('isolated backend failure'));
    else
      lookup.mockResolvedValue([
        {
          name: 'notifications',
          waiting: state === 'stalled' ? 100 : 0,
          active: 0,
          delayed: 0,
          completed: 0,
          failed: 0,
          failedRecent: 0,
        },
      ]);
    const app = Fastify();
    try {
      await app.register(healthRoutes);
      const response = await app.inject({ url: '/health/queue' });
      expect(response.statusCode).toBe(state === 'empty' ? 200 : 503);
      expect(response.json()).toMatchObject({
        status: state === 'empty' ? 'degraded' : 'unavailable',
        workerExecution: workerExecutionStatus,
      });
    } finally {
      await app.close();
    }
  },
);
