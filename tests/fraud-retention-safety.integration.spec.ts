import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { QueueEvents, type Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getConfig } from '../src/shared/config/index.js';
import {
  getQueue,
  QueueName,
  closeAllQueues,
  disconnectQueueConnection,
  getQueueConnection,
} from '../src/shared/queue/index.js';
import {
  createFraudActivityCleanupWorker,
  scheduleFraudActivityCleanup,
} from '../src/modules/fraud-detection/infrastructure/cleanup-queue.js';

const expected = {
  status: 'skipped',
  reason: 'reliable_processing_watermark_unavailable',
  deletedCount: 0,
  backlog: 'unknown',
  cutoff: null,
};

// This suite requires real disposable PostgreSQL and Redis and deliberately
// fails rather than reporting a passing suite with unavailable service skips.
describe('fraud cleanup safety with real PostgreSQL/Redis', () => {
  const prisma = new PrismaClient();
  const address = `retention-test-${randomUUID()}`;
  const network = `retention-test-${randomUUID()}`;
  const ids: string[] = [];
  const workers: Worker[] = [];
  let events: QueueEvents;

  beforeAll(async () => {
    if (getConfig().NODE_ENV !== 'test') throw new Error('Disposable test environment required');
    await prisma.$queryRaw`SELECT 1`;
    const queue = getQueue(QueueName.FraudActivityCleanup);
    await queue.waitUntilReady();
    events = new QueueEvents(QueueName.FraudActivityCleanup, { connection: getQueueConnection() });
    await events.waitUntilReady();
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    vi.restoreAllMocks();
    await prisma.actorActivity.deleteMany({ where: { address } });
    await prisma.blockchainEvent.deleteMany({ where: { network } });
    await prisma.blockchainCheckpoint.deleteMany({ where: { network } });
  });

  afterAll(async () => {
    const queue = getQueue(QueueName.FraudActivityCleanup);
    for (const id of ids) {
      const job = await queue.getJob(id);
      await job?.remove();
    }
    await events?.close();
    await closeAllQueues();
    await disconnectQueueConnection();
    await prisma.$disconnect();
  });

  function start(prismaClient = prisma) {
    const worker = createFraudActivityCleanupWorker(prismaClient);
    workers.push(worker);
    return worker;
  }
  async function enqueue(data: Record<string, unknown> = {}) {
    const id = `retention-test-${randomUUID()}`;
    ids.push(id);
    return getQueue(QueueName.FraudActivityCleanup).add('cleanup', data, { jobId: id });
  }

  it('preserves a multi-batch backlog, active ledger window and exact boundary records', async () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const cutoff = new Date('2026-09-28T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now.getTime());
    const dates = [new Date(cutoff.getTime() - 1), cutoff, new Date(cutoff.getTime() + 1), now];
    await prisma.actorActivity.createMany({
      data: [
        ...Array.from({ length: 2001 }, () => ({
          address,
          category: 'DISPUTE_RAISED' as const,
          occurredAt: new Date('2026-09-27T00:00:00Z'),
        })),
        ...dates.map((occurredAt) => ({
          address,
          category: 'DISPUTE_RAISED' as const,
          occurredAt,
        })),
      ],
    });
    // A durable checkpoint and even a populated processedAt do not prove a
    // contiguous, successful subscriber-processing frontier in this schema.
    await prisma.blockchainEvent.create({
      data: {
        contractName: address,
        network,
        rpcEventId: 'observed',
        ledgerSeq: 999999n,
        txHash: 'fixture',
        topic: [],
        payload: [],
        ledgerClosedAt: new Date('2026-09-27T12:00:00Z'),
        processedAt: now,
      },
    });
    await prisma.blockchainCheckpoint.create({
      data: { contractName: address, network, lastLedgerSeq: 999999n },
    });
    start();
    const job = await enqueue({ cutoff: now.toISOString(), processedLedger: 999999 });
    const result: unknown = await job.waitUntilFinished(events, 10000);
    expect(await prisma.actorActivity.count({ where: { address } })).toBe(2005);
    expect(result).toEqual(expected);
    expect((await getQueue(QueueName.FraudActivityCleanup).getJob(job.id!))?.returnvalue).toEqual(
      expected,
    );
  });

  it('reports skipped with unknown backlog for empty/missing and unreadable database state', async () => {
    start();
    const empty = await enqueue();
    expect(await empty.waitUntilFinished(events, 10000)).toEqual(expected);
    // No trusted processing state exists to read. An unavailable database
    // must not cause fallback to wall time, observed events or job data.
    await workers.pop()!.close();
    const unavailable = new PrismaClient({
      datasourceUrl: 'postgresql://fixture:fixture@127.0.0.1:9/unavailable?connect_timeout=1',
    });
    await expect(unavailable.$queryRaw`SELECT 1`).rejects.toThrow();
    const query = vi.spyOn(unavailable.blockchainEvent, 'findFirst');
    const deletion = vi.spyOn(unavailable.actorActivity, 'deleteMany');
    start(unavailable);
    const missing = await enqueue();
    expect(await missing.waitUntilFinished(events, 10000)).toEqual(expected);
    expect(query).not.toHaveBeenCalled();
    expect(deletion).not.toHaveBeenCalled();
    await unavailable.$disconnect();
  });

  it('keeps persisted waiting jobs safe across producer/worker restart and duplicate concurrent jobs', async () => {
    await prisma.actorActivity.create({
      data: { address, category: 'DELIVERY_CREATED', occurredAt: new Date('2000-01-01T00:00:00Z') },
    });
    const first = await enqueue();
    const duplicate = await getQueue(QueueName.FraudActivityCleanup).add(
      'cleanup',
      {},
      { jobId: first.id! },
    );
    expect(duplicate.id).toBe(first.id);
    const more = await Promise.all(Array.from({ length: 4 }, () => enqueue()));
    await closeAllQueues();
    const children = [
      fork(
        fileURLToPath(new URL('./__fixtures__/fraud-retention-worker.ts', import.meta.url)),
        [],
        {
          execArgv: [
            '--import',
            fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
          ],
          env: process.env,
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      ),
      fork(
        fileURLToPath(new URL('./__fixtures__/fraud-retention-worker.ts', import.meta.url)),
        [],
        {
          execArgv: [
            '--import',
            fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
          ],
          env: process.env,
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      ),
    ];
    try {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve, reject) => {
              child.once('message', (message) => {
                if (message === 'ready') resolve();
                else reject(new Error('Worker did not become ready'));
              });
              child.once('error', reject);
              child.once('exit', (code) =>
                reject(new Error(`Worker exited before ready: ${code}`)),
              );
            }),
        ),
      );
      const results: unknown[] = await Promise.all(
        [first, ...more].map((job) => job.waitUntilFinished(events, 10000)),
      );
      expect(results).toEqual(Array.from({ length: 5 }, () => expected));
      expect(await prisma.actorActivity.count({ where: { address } })).toBe(1);
      // Explicit retry of a completed skipped run must still never delete.
      const saved = await getQueue(QueueName.FraudActivityCleanup).getJob(first.id!);
      await saved!.retry('completed');
      await saved!.waitUntilFinished(events, 10000);
      expect(await prisma.actorActivity.count({ where: { address } })).toBe(1);
    } finally {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
              child.once('exit', () => {
                clearTimeout(timer);
                resolve();
              });
              if (child.connected) child.send('stop');
              else child.kill('SIGKILL');
            }),
        ),
      );
    }
  }, 20000);

  it('recovers a persisted active job after a worker process crashes, without deleting', async () => {
    await prisma.actorActivity.create({
      data: { address, category: 'ESCROW_RELEASED', occurredAt: new Date('2000-01-01T00:00:00Z') },
    });
    const child = fork(
      fileURLToPath(new URL('./__fixtures__/fraud-retention-worker.ts', import.meta.url)),
      [],
      {
        execArgv: [
          '--import',
          fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
        ],
        env: { ...process.env, RETENTION_TEST_CRASH_ON_ACTIVE: '1' },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('error', reject);
        child.once('exit', () => reject(new Error('Worker exited before readiness')));
      });
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      const job = await enqueue();
      await exited;
      expect(child.signalCode).toBe('SIGKILL');
      expect(await job.getState()).toBe('active');
      const recovering = start();
      recovering.opts.stalledInterval = 500;
      expect(await job.waitUntilFinished(events, 40000)).toEqual(expected);
      expect(await job.getState()).toBe('completed');
      expect(await prisma.actorActivity.count({ where: { address } })).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 45000);

  it('retains the durable daily schedule and retry/diagnostic options', async () => {
    const queue = getQueue(QueueName.FraudActivityCleanup);
    const before = new Set((await queue.getRepeatableJobs()).map((job) => job.key));
    try {
      await scheduleFraudActivityCleanup();
      const repeats = await queue.getRepeatableJobs();
      expect(repeats).toContainEqual(
        expect.objectContaining({ name: 'cleanup', every: '86400000' }),
      );
      const job = await enqueue();
      expect(job.opts).toMatchObject({
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnFail: { age: 604800 },
      });
      start();
      expect(await job.waitUntilFinished(events, 10000)).toEqual(expected);
    } finally {
      for (const job of await queue.getRepeatableJobs())
        if (!before.has(job.key)) await queue.removeRepeatableByKey(job.key);
    }
  });
});
