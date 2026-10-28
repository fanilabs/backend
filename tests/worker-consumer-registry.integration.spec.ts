import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { QueueEvents } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Worker } from 'bullmq';
import type { QueueNameValue } from '../src/shared/queue/index.js';
import { createWorkerEventConsumers } from '../src/workers/event-consumers.js';
import {
  CONSUMER_IDS,
  createConsumerRegistry,
  createIndexerBackgroundWorker,
} from '../src/modules/indexer/index.js';
import type { BlockedConsumerRegistration } from '../src/modules/indexer/index.js';
import { createPrismaEventStore } from '../src/modules/indexer/infrastructure/prisma-event-store.js';
import { eventProcessingStatus } from '../src/modules/indexer/infrastructure/event-processing-status.js';
import { publishBlockchainEvent } from '../src/shared/events/index.js';
import {
  getQueue,
  getQueueConnection,
  QueueName,
  closeAllQueues,
  disconnectQueueConnection,
} from '../src/shared/queue/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

const prisma = new PrismaClient();
const network = `registry-${randomUUID()}`;
const ids: Array<{ queue: QueueNameValue; id: string }> = [];
const workers: Worker[] = [];
const events = new QueueEvents(QueueName.BlockchainIndexer, { connection: getQueueConnection() });
const fixtureEvent = () => ({
  contractName: 'delivery',
  network,
  rpcEventId: randomUUID(),
  ledgerSeq: 42n,
  txHash: 'fixture',
  topic: ['delivery_created'],
  payload: ['7', testAddress('sender')],
  closedAt: new Date('2026-10-28'),
});
const registration: BlockedConsumerRegistration = {
  id: 'deliveries',
  blockedBy: ['unverified_recovery'],
  handler: async () => {
    throw new Error('A gated handler was called');
  },
};
async function snapshot() {
  return Promise.all([
    prisma.delivery.count(),
    prisma.escrow.count(),
    prisma.dispute.count(),
    prisma.fleet.count(),
    prisma.fleetDriver.count(),
    prisma.driverProfile.count(),
    prisma.actorActivity.count(),
    prisma.notification.count(),
    prisma.blockchainCheckpoint.count(),
    prisma.blockchainEvent.count(),
  ]);
}
async function pollJob() {
  const id = `registry-test-${randomUUID()}`;
  ids.push({ queue: QueueName.BlockchainIndexer, id });
  return getQueue(QueueName.BlockchainIndexer).add(
    'poll-contract',
    {
      contractName: 'delivery',
      contractId: 'isolated-no-RPC-allowed',
      network,
    },
    { jobId: id, attempts: 1 },
  );
}
beforeAll(async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('Disposable test environment required');
  await prisma.$queryRaw`SELECT 1`;
  expect(await getQueueConnection().ping()).toBe('PONG');
  await events.waitUntilReady();
});
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
});
afterAll(async () => {
  for (const { queue, id } of ids) await (await getQueue(queue).getJob(id))?.remove();
  await prisma.$executeRaw`DELETE FROM event_consumer_obligations WHERE event_id IN (SELECT id FROM blockchain_events WHERE network = ${network})`;
  await prisma.$executeRaw`DELETE FROM event_processing_receipts WHERE event_id IN (SELECT id FROM blockchain_events WHERE network = ${network})`;
  await prisma.blockchainEvent.deleteMany({ where: { network } });
  await events.close();
  await closeAllQueues();
  await disconnectQueueConnection();
  await prisma.$disconnect();
});
describe('production worker event composition, execution gated', () => {
  it('constructs all real consumers without effects or old-bus subscriptions', async () => {
    const before = await snapshot();
    const notifications = await getQueue(QueueName.Notifications).getJobCounts();
    const registry = createWorkerEventConsumers(prisma);
    expect(registry.registeredIds()).toEqual(CONSUMER_IDS);
    expect(registry.describe().consumers).toEqual(
      CONSUMER_IDS.map((id) => ({
        id,
        implemented: true,
        registered: true,
        execution: 'blocked',
        blockedBy: expect.any(Array),
      })),
    );
    expect(registry.describe().unimplemented).toEqual([
      {
        eventType: 'identity-reputation.user_registered',
        consumer: 'users',
        reason: 'users_projection_unresolved',
      },
    ]);
    for (const consumer of registry.describe().consumers)
      expect(consumer.blockedBy.length).toBeGreaterThan(0);
    // Uses the real bus. New registry construction must not attach the unsafe handlers.
    await publishBlockchainEvent(fixtureEvent());
    expect(await snapshot()).toEqual(before);
    expect(await getQueue(QueueName.Notifications).getJobCounts()).toEqual(notifications);
    expect(() => registry.assertCanProcessEvent(fixtureEvent())).toThrow('execution blocked');
    expect(await snapshot()).toEqual(before);
  });
  it('uses the same stable identities as persisted obligations without implying completion', async () => {
    const e = fixtureEvent();
    const registry = createWorkerEventConsumers(prisma);
    await createPrismaEventStore(prisma).tryInsert(e);
    const raw = await prisma.blockchainEvent.findFirstOrThrow({
      where: { network, rpcEventId: e.rpcEventId },
    });
    expect(await eventProcessingStatus(prisma, raw.id, registry.registeredIds())).toMatchObject({
      complete: false,
      status: 'blocked',
      missingRegistrations: [],
      obligations: [
        { consumer_id: 'deliveries', blocked_reason: 'consumer_recovery_not_verified' },
        { consumer_id: 'fraud-activity', blocked_reason: 'consumer_recovery_not_verified' },
      ],
    });
    expect(raw.processedAt).toBeNull();
    const legacy = await prisma.blockchainEvent.create({
      data: {
        contractName: e.contractName,
        network,
        rpcEventId: randomUUID(),
        ledgerSeq: e.ledgerSeq,
        txHash: e.txHash,
        topic: e.topic,
        payload: e.payload,
        ledgerClosedAt: e.closedAt,
        processedAt: e.closedAt,
      },
    });
    expect(await eventProcessingStatus(prisma, legacy.id, registry.registeredIds())).toEqual({
      status: 'historical_unknown',
      complete: false,
    });
    expect(await prisma.blockchainCheckpoint.count({ where: { network } })).toBe(0);
  });
  it('rejects missing, duplicate and empty-prerequisite registrations clearly', () => {
    const missing = createConsumerRegistry([registration]);
    expect(missing.describe().consumers.find((c) => c.id === 'fraud-activity')).toMatchObject({
      registered: false,
      execution: 'blocked',
      blockedBy: ['missing_registration'],
    });
    expect(() => missing.assertRequiredRegistrations()).toThrow(
      'Missing required event consumer registrations: escrow',
    );
    expect(() => missing.assertCanProcessEvent(fixtureEvent())).toThrow(
      'Missing required event consumer registrations: fraud-activity',
    );
    expect(() => createConsumerRegistry([registration, registration])).toThrow(
      'Duplicate event consumer registration: deliveries',
    );
    expect(() => createConsumerRegistry([{ ...registration, blockedBy: [] }])).toThrow(
      'Recovery prerequisites required: deliveries',
    );
    expect(() =>
      missing.assertCanProcessEvent({
        ...fixtureEvent(),
        contractName: 'identity-reputation',
        topic: ['user_registered'],
      }),
    ).toThrow('users_projection_unresolved');
    expect(() => missing.assertCanProcessContract('unknown')).toThrow(
      'Unresolved event consumer policy',
    );
  });
  it('fails a real poll job before RPC, event handling or checkpoint writes when registrations are missing', async () => {
    const before = await snapshot();
    const job = await pollJob();
    const registry = createConsumerRegistry([]);
    const worker = createIndexerBackgroundWorker(prisma, registry);
    workers.push(worker);
    await worker.waitUntilReady();
    await expect(job.waitUntilFinished(events, 10000)).rejects.toThrow(
      'Missing required event consumer registrations',
    );
    expect(await snapshot()).toEqual(before);
  });
  it('the actual startup entry exposes blocked registrations and never processes pending mail or advances a checkpoint', async () => {
    const before = await snapshot();
    const notificationId = `registry-mail-${randomUUID()}`;
    ids.push({ queue: QueueName.Notifications, id: notificationId });
    const mail = await getQueue(QueueName.Notifications).add(
      'send-notification',
      { notificationId: 'isolated-fixture' },
      { jobId: notificationId, attempts: 1 },
    );
    const job = await pollJob();
    const cleanup = getQueue(QueueName.FraudActivityCleanup);
    const repeatKeys = new Set((await cleanup.getRepeatableJobs()).map((j) => j.key));
    const child = fork(fileURLToPath(new URL('../src/workers/index.ts', import.meta.url)), [], {
      execArgv: [
        '--import',
        fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
      ],
      env: {
        ...process.env,
        LOG_LEVEL: 'info',
        WORKER_HEARTBEAT_DIR: `/tmp/registry-${randomUUID()}`,
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let output = '';
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      for (let i = 0; i < 400 && !output.includes('Worker process started'); i++) {
        if (child.exitCode !== null) throw new Error(`Worker startup failed: ${output}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(output).toContain('Worker process started');
      expect(output).toContain('Event consumers registered; execution blocked');
      for (const id of CONSUMER_IDS) expect(output).toContain(`"id":"${id}"`);
      expect(output).toContain('users_projection_unresolved');
      await expect(job.waitUntilFinished(events, 10000)).rejects.toThrow(
        'Event consumer execution blocked for delivery',
      );
      expect(await mail.getState()).toBe('waiting');
      expect(await snapshot()).toEqual(before);
    } finally {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.kill('SIGTERM');
      await exited;
      clearTimeout(timer);
      for (const repeat of await cleanup.getRepeatableJobs()) {
        if (!repeatKeys.has(repeat.key)) await cleanup.removeRepeatableByKey(repeat.key);
      }
    }
  }, 20000);
});
