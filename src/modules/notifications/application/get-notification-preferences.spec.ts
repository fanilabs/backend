import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGetNotificationPreferencesUseCase } from './get-notification-preferences.js';
import { createFakeNotificationPreferenceRepository } from './__fixtures__/fakes.js';
import type { NotificationPreference } from '../domain/index.js';

function buildPreference(
  overrides: Partial<NotificationPreference> = {},
): NotificationPreference {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: randomUUID(),
    userId: 'user-1',
    eventType: 'DELIVERY_DRIVER_ASSIGNED',
    disabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('getNotificationPreferences', () => {
  it('returns an empty list when the user has no stored preferences', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    const getNotificationPreferences = createGetNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await getNotificationPreferences({ userId: 'user-1' });

    expect(result.preferences).toEqual([]);
  });

  it("returns only the requesting user's own preferences", async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-1', eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: true }),
    );
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-2', eventType: 'ESCROW_RELEASED', disabled: true }),
    );
    const getNotificationPreferences = createGetNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await getNotificationPreferences({ userId: 'user-1' });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]?.eventType).toBe('DELIVERY_DRIVER_ASSIGNED');
    expect(result.preferences[0]?.userId).toBe('user-1');
  });

  it('returns all stored preferences for the user regardless of disabled value', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-3', eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: true }),
    );
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-3', eventType: 'ESCROW_RELEASED', disabled: false }),
    );
    const getNotificationPreferences = createGetNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await getNotificationPreferences({ userId: 'user-3' });

    expect(result.preferences).toHaveLength(2);
  });
});
