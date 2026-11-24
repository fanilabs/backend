import type {
  NotificationEventType,
  NotificationPreference,
  NotificationPreferenceRepository,
} from '../domain/index.js';

export interface UpdateNotificationPreferencesDeps {
  notificationPreferenceRepository: NotificationPreferenceRepository;
}

export interface PreferenceUpdate {
  eventType: NotificationEventType;
  disabled: boolean;
}

export interface UpdateNotificationPreferencesInput {
  userId: string;
  updates: PreferenceUpdate[];
}

export interface UpdateNotificationPreferencesResult {
  preferences: NotificationPreference[];
}

/**
 * Writes per-user, per-event-type notification preferences for the
 * requesting user (#698). Each entry in `updates` is an upsert: a row is
 * created when none exists, or updated when one does. Only the event types
 * named in `updates` are touched; all others remain unchanged.
 *
 * Always scoped to `input.userId` — `routes.ts` passes `request.user.id`
 * directly, never a caller-supplied id, so users can only modify their own
 * preferences.
 *
 * Returns the full post-update preference list for the user so the client
 * does not need a follow-up GET.
 */
export function createUpdateNotificationPreferencesUseCase(
  deps: UpdateNotificationPreferencesDeps,
) {
  return async function updateNotificationPreferences(
    input: UpdateNotificationPreferencesInput,
  ): Promise<UpdateNotificationPreferencesResult> {
    for (const update of input.updates) {
      await deps.notificationPreferenceRepository.upsert({
        userId: input.userId,
        eventType: update.eventType,
        disabled: update.disabled,
      });
    }
    const preferences = await deps.notificationPreferenceRepository.listByUserId(input.userId);
    return { preferences };
  };
}
