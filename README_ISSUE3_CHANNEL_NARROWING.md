# Issue 3: Narrow the notification channel contract to what's implemented

## Direction chosen

Of the two options the issue proposed (complete the multi-channel
abstraction vs. narrow the surface to match reality), this went with the
**narrow** option — smaller, and doesn't speculatively build SMS/PUSH
adapters nobody has asked to use yet.

## What changed

- `src/modules/notifications/interface/schemas.ts`: `notificationChannel`
  changed from `z.enum(['EMAIL', 'SMS', 'PUSH'])` to `z.literal('EMAIL')`,
  so the API can no longer advertise a channel value the system can never
  produce.
- `prisma/schema.prisma`: `NotificationChannel` enum keeps all three
  variants (`EMAIL`/`SMS`/`PUSH`) for forward compatibility, with a comment
  explaining why the API contract is narrower than the database enum.
- `src/modules/notifications/domain/errors.ts` /`ports.ts`/`index.ts`:
  removed `NotificationDeliveryError` — it was unused (nothing ever threw
  it), which is exactly the "placeholder implementation" pattern
  `CONTRIBUTING.md`'s Code Standards prohibit. `sendNotification` still
  catches and marks `FAILED` on whatever a real sender throws; a dedicated
  error type can come back once a real implementation needs one.
- `NotificationSender`'s port comment documents the narrowing decision.
- `docs/API_REFERENCE.md` updated to describe `channel` as the literal
  `EMAIL`, not "always EMAIL" out of three theoretically-possible values.

## Not done in this pass

`src/modules/notifications/interface/notifications-routes.integration.spec.ts`
likely asserts against the old three-value enum shape and wasn't updated
(no test runs performed per this task's scope).
