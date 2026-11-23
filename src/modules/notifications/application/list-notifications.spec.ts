import { describe, expect, it } from 'vitest';
import { createListNotificationsUseCase } from './list-notifications.js';
import { buildNotification, createInMemoryNotificationRepository } from './__fixtures__/fakes.js';

describe('listNotifications', () => {
  it("only returns the requesting user's own notifications", async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    notificationRepository.seed(buildNotification({ userId: 'user-2' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe('user-1');
    expect(result.nextCursor).toBeNull();
  });

  it('filters by status when provided', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1', status: 'SENT' }));
    notificationRepository.seed(buildNotification({ userId: 'user-1', status: 'PENDING' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', status: 'SENT' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe('SENT');
    expect(result.nextCursor).toBeNull();
  });

  it('filters to only unread notifications when unread is true', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1', readAt: null }));
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', readAt: new Date('2026-01-02T00:00:00Z') }),
    );
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', unread: true });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.readAt).toBeNull();
  });

  it('filters to only read notifications when unread is false', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1', readAt: null }));
    const readAt = new Date('2026-01-02T00:00:00Z');
    notificationRepository.seed(buildNotification({ userId: 'user-1', readAt }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', unread: false });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.readAt).not.toBeNull();
  });

  it('filters by channel when provided', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1', channel: 'EMAIL' }));
    notificationRepository.seed(buildNotification({ userId: 'user-1', channel: 'SMS' }));
    notificationRepository.seed(buildNotification({ userId: 'user-1', channel: 'PUSH' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const emailResult = await listNotifications({ userId: 'user-1', channel: 'EMAIL' });
    expect(emailResult.items).toHaveLength(1);
    expect(emailResult.items[0]?.channel).toBe('EMAIL');

    const smsResult = await listNotifications({ userId: 'user-1', channel: 'SMS' });
    expect(smsResult.items).toHaveLength(1);
    expect(smsResult.items[0]?.channel).toBe('SMS');

    const pushResult = await listNotifications({ userId: 'user-1', channel: 'PUSH' });
    expect(pushResult.items).toHaveLength(1);
    expect(pushResult.items[0]?.channel).toBe('PUSH');
  });

  it('composes unread and channel filters together', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    // unread EMAIL — should match
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'EMAIL', readAt: null }),
    );
    // read EMAIL — should not match unread=true
    notificationRepository.seed(
      buildNotification({
        userId: 'user-1',
        channel: 'EMAIL',
        readAt: new Date('2026-01-02T00:00:00Z'),
      }),
    );
    // unread SMS — wrong channel
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'SMS', readAt: null }),
    );
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', unread: true, channel: 'EMAIL' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.channel).toBe('EMAIL');
    expect(result.items[0]?.readAt).toBeNull();
  });

  it('composes status and channel filters together', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'EMAIL', status: 'SENT' }),
    );
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'EMAIL', status: 'PENDING' }),
    );
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'SMS', status: 'SENT' }),
    );
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({
      userId: 'user-1',
      status: 'SENT',
      channel: 'EMAIL',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.channel).toBe('EMAIL');
    expect(result.items[0]?.status).toBe('SENT');
  });

  it('never returns another user\'s notifications even when filters match', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'EMAIL', readAt: null }),
    );
    notificationRepository.seed(
      buildNotification({ userId: 'user-2', channel: 'EMAIL', readAt: null }),
    );
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({
      userId: 'user-1',
      unread: true,
      channel: 'EMAIL',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe('user-1');
  });

  it('caps limit at 100 even if a larger value is requested', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 150; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', limit: 500 });

    expect(result.items).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(result.limit).toBe(100);
  });

  it('defaults to a limit of 20 when none is given', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 30; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).not.toBeNull();
    expect(result.limit).toBe(20);
  });

  it('populates nextCursor when more items remain beyond the page', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 25; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', limit: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).not.toBeNull();
    expect(result.limit).toBe(10);
  });

  it('returns null nextCursor on the last page', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 5; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
    expect(result.limit).toBe(20);
  });
});
