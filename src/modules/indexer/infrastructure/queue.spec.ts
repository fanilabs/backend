import { createConsumerRegistry } from '../application/consumer-registry.js';
import type { PrismaClient } from '@prisma/client';
import { Worker } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getQueueConnectionMock, getSorobanClientMock } = vi.hoisted(() => ({
  getQueueConnectionMock: vi.fn(() => ({ fakeRedis: true })),
  getSorobanClientMock: vi.fn(() => ({})),
}));

vi.mock('bullmq', () => ({
  Worker: vi.fn(),
}));

vi.mock('../../../shared/queue/index.js', () => ({
  getQueue: vi.fn(),
  getQueueConnection: getQueueConnectionMock,
  QueueName: { BlockchainIndexer: 'blockchain-indexer' },
}));

vi.mock('../../../blockchain/soroban-client.js', () => ({
  getSorobanClient: getSorobanClientMock,
}));

// Real (unmocked) queue names — the barrel above is mocked to avoid
// constructing a live ioredis connection.
import { QueueName } from '../../../shared/queue/queues.js';
import { createIndexerWorker, indexerWorkerOptions } from './queue.js';

describe('createIndexerWorker configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Worker).mockImplementation(function mockWorker(this: unknown) {
      return {} as Worker;
    });
  });

  it('declares explicit lock and stalled intervals rather than relying on library defaults (issue #356)', () => {
    expect(indexerWorkerOptions).toEqual({
      concurrency: 1,
      lockDuration: 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    });
  });

  it('constructs the BullMQ Worker with those options and the shared connection (issue #356)', () => {
    createIndexerWorker({} as PrismaClient, createConsumerRegistry([]));

    expect(Worker).toHaveBeenCalledTimes(1);
    const [queueName, processor, opts] = vi.mocked(Worker).mock.calls[0]!;

    expect(queueName).toBe(QueueName.BlockchainIndexer);
    expect(processor).toEqual(expect.any(Function));
    expect(opts).toEqual(
      expect.objectContaining({
        connection: { fakeRedis: true },
        concurrency: 1,
        lockDuration: 60_000,
        stalledInterval: 30_000,
        maxStalledCount: 2,
      }),
    );
  });

  it('keeps concurrency strictly at 1 so poll ticks never overlap', () => {
    createIndexerWorker({} as PrismaClient, createConsumerRegistry([]));

    const [, , opts] = vi.mocked(Worker).mock.calls[0]!;
    // Concurrent polls against the same Soroban RPC can ingest events out
    // of order and corrupt the monotonic blockchain_events sequence.
    expect((opts as { concurrency: number }).concurrency).toBe(1);
  });
});
