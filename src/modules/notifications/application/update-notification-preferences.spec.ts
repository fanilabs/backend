import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createUpdateNotificationPreferencesUseCase } from './update-notification-preferences.js';
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

describe('updateNotificationPreferences', () => {
  it('creates a new preference row when none exists for the event type', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    const updateNotificationPreferences = createUpdateNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await updateNotificationPreferences({
      userId: 'user-1',
      updates: [{ eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: true }],
    });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]).toMatchObject({
      userId: 'user-1',
      eventType: 'DELIVERY_DRIVER_ASSIGNED',
      disabled: true,
    });
  });

  it('updates an existing preference row in place', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-2', eventType: 'ESCROW_RELEASED', disabled: false }),
    );
    const updateNotificationPreferences = createUpdateNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await updateNotificationPreferences({
      userId: 'user-2',
      updates: [{ eventType: 'ESCROW_RELEASED', disabled: true }],
    });

    expect(result.preferences).toHaveLength(1);
    expect(result.preferences[0]).toMatchObject({
      eventType: 'ESCROW_RELEASED',
      disabled: true,
    });
  });

  it('applies multiple updates in a single call', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    const updateNotificationPreferences = createUpdateNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await updateNotificationPreferences({
      userId: 'user-3',
      updates: [
        { eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: true },
        { eventType: 'FLEET_REGISTERED', disabled: true },
        { eventType: 'DISPUTE_RAISED', disabled: false },
      ],
    });

    expect(result.preferences).toHaveLength(3);
    const byType = new Map(result.preferences.map((p) => [p.eventType, p.disabled]));
    expect(byType.get('DELIVERY_DRIVER_ASSIGNED')).toBe(true);
    expect(byType.get('FLEET_REGISTERED')).toBe(true);
    expect(byType.get('DISPUTE_RAISED')).toBe(false);
  });

  it('only modifies the named event types — other preferences are untouched', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-4', eventType: 'ESCROW_RELEASED', disabled: false }),
    );
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-4', eventType: 'DISPUTE_RAISED', disabled: false }),
    );
    const updateNotificationPreferences = createUpdateNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    // Only update ESCROW_RELEASED
    await updateNotificationPreferences({
      userId: 'user-4',
      updates: [{ eventType: 'ESCROW_RELEASED', disabled: true }],
    });

    // Verify DISPUTE_RAISED is unchanged
    const unchanged = await notificationPreferenceRepository.isDisabled('user-4', 'DISPUTE_RAISED');
    expect(unchanged).toBe(false);
  });

  it('returns the full post-update preference list (not just updated entries)', async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-5', eventType: 'ESCROW_RELEASED', disabled: false }),
    );
    const updateNotificationPreferences = createUpdateNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    const result = await updateNotificationPreferences({
      userId: 'user-5',
      updates: [{ eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: true }],
    });

    // Both the pre-existing ESCROW_RELEASED and the new DELIVERY_DRIVER_ASSIGNED are present
    expect(result.preferences).toHaveLength(2);
  });

  it("never touches another user's preferences", async () => {
    const notificationPreferenceRepository = createFakeNotificationPreferenceRepository();
    notificationPreferenceRepository.seedPreference(
      buildPreference({ userId: 'user-other', eventType: 'ESCROW_RELEASED', disabled: false }),
    );
    const updateNotificationPreferences = createUpdateNotificationPreferencesUseCase({
      notificationPreferenceRepository,
    });

    // Update user-6's preferences
    await updateNotificationPreferences({
      userId: 'user-6',
      updates: [{ eventType: 'ESCROW_RELEASED', disabled: true }],
    });

    // user-other's preference is unchanged
    const otherDisabled = await notificationPreferenceRepository.isDisabled(
      'user-other',
      'ESCROW_RELEASED',
    );
    expect(otherDisabled).toBe(false);
  });
});
