import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();

vi.mock('../../../shared/queue/index.js', () => ({
  getQueue: vi.fn(() => ({ add })),
  getQueueConnection: vi.fn(() => ({})),
  QueueName: { Notifications: 'notifications' },
}));

describe('createNotificationJobScheduler (#358)', () => {
  beforeEach(() => {
    add.mockClear();
    add.mockResolvedValue({});
  });

  it('enqueues send-notification jobs with 5 attempts and exponential backoff', async () => {
    const { createNotificationJobScheduler } = await import('./queue.js');
    const scheduler = createNotificationJobScheduler();

    await scheduler.enqueueDelivery('notif-123');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'send-notification',
      { notificationId: 'notif-123' },
      {
        jobId: 'send-notif-123',
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });
});
