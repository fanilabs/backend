import { describe, expect, it } from 'vitest';
import {
  getNotificationResponseSchema,
  listNotificationsResponseSchema,
} from './schemas.js';

/**
 * Regression coverage for the notification channel data/type mismatch: the
 * response schema previously only accepted `channel: 'EMAIL'` (#103), so
 * any persisted `SMS`/`PUSH` row (prisma/seed.ts seeds both) failed
 * response serialization — turning a read of that user's own notifications
 * into a 500 instead of returning their EMAIL notifications successfully.
 */
function notificationDto(channel: string) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    channel,
    type: 'delivery.status_changed',
    payload: {},
    status: 'PENDING',
    sentAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('notification response schemas', () => {
  it('accepts a persisted EMAIL notification', () => {
    const result = getNotificationResponseSchema.safeParse({ data: notificationDto('EMAIL') });
    expect(result.success).toBe(true);
  });

  it('accepts a persisted SMS notification instead of failing serialization', () => {
    const result = getNotificationResponseSchema.safeParse({ data: notificationDto('SMS') });
    expect(result.success).toBe(true);
  });

  it('accepts a persisted PUSH notification instead of failing serialization', () => {
    const result = getNotificationResponseSchema.safeParse({ data: notificationDto('PUSH') });
    expect(result.success).toBe(true);
  });

  it('accepts a mixed-channel list without any row failing validation', () => {
    const result = listNotificationsResponseSchema.safeParse({
      data: [notificationDto('EMAIL'), notificationDto('SMS'), notificationDto('PUSH')],
      meta: { limit: 20, nextCursor: null },
    });
    expect(result.success).toBe(true);
  });

  it('still rejects a channel value outside the persisted domain enum', () => {
    const result = getNotificationResponseSchema.safeParse({ data: notificationDto('CARRIER_PIGEON') });
    expect(result.success).toBe(false);
  });
});
