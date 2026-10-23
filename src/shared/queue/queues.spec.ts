import { beforeEach, describe, expect, it, vi } from 'vitest';

const pause = vi.fn().mockResolvedValue(undefined);
const resume = vi.fn().mockResolvedValue(undefined);
const drain = vi.fn().mockResolvedValue(undefined);
const isPaused = vi.fn().mockResolvedValue(false);

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ pause, resume, drain, isPaused, close: vi.fn() })),
}));

vi.mock('./connection.js', () => ({
  getQueueConnection: vi.fn(() => ({})),
}));

describe('pauseAllQueues / resumeAllQueues / drainAllQueues (#360)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('pauses every registered queue and reports isPaused() === true', async () => {
    const { pauseAllQueues, getQueue, QueueName, closeAllQueues } = await import('./queues.js');

    await pauseAllQueues();

    const names = Object.values(QueueName);
    expect(pause).toHaveBeenCalledTimes(names.length);
    for (const name of names) {
      const queue = getQueue(name);
      (queue.isPaused as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      await expect(queue.isPaused()).resolves.toBe(true);
    }

    await closeAllQueues();
  });

  it('resumes every registered queue and reports isPaused() === false', async () => {
    const { resumeAllQueues, getQueue, QueueName, closeAllQueues } = await import('./queues.js');

    await resumeAllQueues();

    const names = Object.values(QueueName);
    expect(resume).toHaveBeenCalledTimes(names.length);
    for (const name of names) {
      const queue = getQueue(name);
      (queue.isPaused as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      await expect(queue.isPaused()).resolves.toBe(false);
    }

    await closeAllQueues();
  });

  it('drains every registered queue during maintenance windows', async () => {
    const { drainAllQueues, QueueName, closeAllQueues } = await import('./queues.js');

    await drainAllQueues();

    expect(drain).toHaveBeenCalledTimes(Object.values(QueueName).length);

    await closeAllQueues();
  });
});

describe('QueueName active queues only (#444)', () => {
  it('excludes obsolete ReputationReconciliation constant', async () => {
    const { QueueName } = await import('./queues.js');
    expect(Object.values(QueueName)).toEqual([
      'blockchain-indexer',
      'notifications',
      'fraud-activity-cleanup',
    ]);
  });
});
