import { describe, expect, it, vi } from 'vitest';

const onSpy = vi.fn();
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: onSpy })),
}));
vi.mock('../../../shared/queue/index.js', () => ({
  getQueue: vi.fn(),
  getQueueConnection: vi.fn(() => ({})),
  QueueName: { FraudActivityCleanup: 'fraud-activity-cleanup' },
}));

import { createFraudActivityCleanupWorker } from './cleanup-queue.js';

describe('createFraudActivityCleanupWorker (#443)', () => {
  it('attaches error and failed event listeners to BullMQ Worker', () => {
    createFraudActivityCleanupWorker({} as never);
    const events = onSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain('error');
    expect(events).toContain('failed');
  });
});
