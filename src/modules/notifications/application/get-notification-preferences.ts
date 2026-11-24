import type { NotificationPreference, NotificationPreferenceRepository } from '../domain/index.js';

export interface GetNotificationPreferencesDeps {
  notificationPreferenceRepository: NotificationPreferenceRepository;
}

export interface GetNotificationPreferencesInput {
  userId: string;
}

export interface GetNotificationPreferencesResult {
  preferences: NotificationPreference[];
}

/**
 * Returns all stored notification event-type preferences for the requesting
 * user (#698). Event types not represented in the list have no stored
 * preference, meaning the default behavior (notifications enabled) applies.
 *
 * Always scoped to the requesting user — `routes.ts` passes
 * `request.user.id` directly.
 */
export function createGetNotificationPreferencesUseCase(deps: GetNotificationPreferencesDeps) {
  return async function getNotificationPreferences(
    input: GetNotificationPreferencesInput,
  ): Promise<GetNotificationPreferencesResult> {
    const preferences = await deps.notificationPreferenceRepository.listByUserId(input.userId);
    return { preferences };
  };
}
