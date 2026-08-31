import { afterAll, describe, expect, it } from 'vitest';
import { getQueueHealth } from './queue-health.js';
import { QueueName, getQueue, closeAllQueues } from './queues.js';
import { isDatabaseAvailable } from '../testing/database.js';

// Gated on Postgres availability, same as every other integration
// suite — `make db-up` brings up Postgres and Redis together, so
// Postgres reachability is this codebase's existing proxy for "the local
// dev stack is up" (see any `*.integration.spec.ts`'s own gate).
const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('getQueueHealth (integration)', () => {
  afterAll(async () => {
    await closeAllQueues();
  });

  it('reports non-negative counts for every monitored queue', async () => {
    const queues = await getQueueHealth();

    expect(queues).toEqual([
      expect.objectContaining({ name: QueueName.BlockchainIndexer }),
      expect.objectContaining({ name: QueueName.Notifications }),
    ]);
    for (const queue of queues) {
      expect(queue.waiting).toBeGreaterThanOrEqual(0);
      expect(queue.active).toBeGreaterThanOrEqual(0);
      expect(queue.delayed).toBeGreaterThanOrEqual(0);
      expect(queue.failed).toBeGreaterThanOrEqual(0);
      expect(queue.completed).toBeGreaterThanOrEqual(0);
    }
  });

  it('reflects a newly-enqueued job in the waiting count', async () => {
    const before = await getQueueHealth();
    const beforeWaiting = before.find((q) => q.name === QueueName.Notifications)?.waiting ?? 0;

    await getQueue(QueueName.Notifications).add(
      'send-notification',
      { notificationId: 'queue-health-test' },
      { jobId: `queue-health-test-${Date.now()}` },
    );

    const after = await getQueueHealth();
    const afterWaiting = after.find((q) => q.name === QueueName.Notifications)?.waiting ?? 0;
    expect(afterWaiting).toBeGreaterThan(beforeWaiting);
  });

  it('counts a job that failed within the recent window in both failed and failedRecent', async () => {
    const queue = getQueue(QueueName.Notifications);
    const job = await queue.add(
      'send-notification',
      { notificationId: 'queue-health-failure-test' },
      { jobId: `queue-health-failure-test-${Date.now()}`, attempts: 1 },
    );
    await job.moveToFailed(new Error('simulated failure for queue-health test'), '0', true);

    const queues = await getQueueHealth();
    const notifications = queues.find((q) => q.name === QueueName.Notifications);

    expect(notifications).toBeDefined();
    expect(notifications?.failed).toBeGreaterThan(0);
    expect(notifications?.failedRecent).toBeGreaterThan(0);
  });
});
