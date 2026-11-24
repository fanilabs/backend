import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createListNotificationsUseCase, decodeCursor, encodeCursor } from './list-notifications.js';
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
    notificationRepository.seed(
      buildNotification({ userId: 'user-1', channel: 'EMAIL', readAt: null }),
    );
    notificationRepository.seed(
      buildNotification({
        userId: 'user-1',
        channel: 'EMAIL',
        readAt: new Date('2026-01-02T00:00:00Z'),
      }),
    );
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

  it("never returns another user's notifications even when filters match", async () => {
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

  it('returns null nextCursor on the last page (fewer than limit rows)', async () => {
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

  // #695 — exact-size final page must not advertise a cursor
  it('returns null nextCursor when exactly limit rows exist and no more follow', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    // Seed exactly 10 notifications — the same count as the requested limit.
    for (let i = 0; i < 10; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-exact' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-exact', limit: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBeNull();
  });

  // #695 — timestamp ties must not drop rows at a page boundary
  it('returns every row exactly once across pages when several share the same createdAt', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    const sharedTimestamp = new Date('2026-06-01T12:00:00Z');
    // 6 notifications all with the same createdAt but distinct ids
    const ids: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = randomUUID();
      ids.push(id);
      notificationRepository.seed(
        buildNotification({ id, userId: 'user-ties', createdAt: sharedTimestamp }),
      );
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const page1 = await listNotifications({ userId: 'user-ties', limit: 4 });
    expect(page1.items).toHaveLength(4);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listNotifications({
      userId: 'user-ties',
      limit: 4,
      before: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const allIds = [...page1.items, ...page2.items].map((n) => n.id).sort();
    expect(allIds).toEqual([...ids].sort());
  });

  // #695 — cursor encode/decode round-trip
  it('encodes and decodes a cursor losslessly', () => {
    const date = new Date('2026-06-15T09:30:00.000Z');
    const id = randomUUID();
    const encoded = encodeCursor(date, id);
    const decoded = decodeCursor(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded!.id).toBe(id);
  });

  it('decodeCursor returns null for a malformed value', () => {
    expect(decodeCursor('not-base64!')).toBeNull();
    expect(decodeCursor(Buffer.from('{"bad":"shape"}').toString('base64'))).toBeNull();
  });
});
