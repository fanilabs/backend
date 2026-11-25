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

describe('getQueue producer reuse and recreation (#676)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reuses one cached handle per queue within a lifecycle, keeps names separate, and constructs a fresh handle after a full close', async () => {
    const closeResolvers: Array<() => void> = [];
    const QueueMock = vi.fn().mockImplementation(() => ({
      pause,
      resume,
      drain,
      isPaused,
      close: vi.fn(() => new Promise<void>((resolve) => closeResolvers.push(resolve))),
    }));
    vi.doMock('bullmq', () => ({ Queue: QueueMock }));
    vi.doMock('./connection.js', () => ({ getQueueConnection: vi.fn(() => ({})) }));

    const { getQueue, closeAllQueues, QueueName } = await import('./queues.js');

    // Reuse: two calls for the same name return the same cached handle.
    const first = getQueue(QueueName.Notifications);
    const second = getQueue(QueueName.Notifications);
    expect(second).toBe(first);
    expect(QueueMock).toHaveBeenCalledTimes(1);

    // Per-name separation: a different name constructs a distinct handle.
    const other = getQueue(QueueName.BlockchainIndexer);
    expect(other).not.toBe(first);
    expect(QueueMock).toHaveBeenCalledTimes(2);

    // Close everything; the handles stay cached until every close resolves.
    const closePromise = closeAllQueues();
    expect(closeResolvers).toHaveLength(2);
    for (const resolve of closeResolvers) resolve();
    await closePromise;

    // After the full close completes, requesting the same name again
    // constructs a genuinely new handle rather than returning a stale one.
    const afterClose = getQueue(QueueName.Notifications);
    expect(afterClose).not.toBe(first);
    expect(QueueMock).toHaveBeenCalledTimes(3);

    await closeAllQueues();
  });
});
