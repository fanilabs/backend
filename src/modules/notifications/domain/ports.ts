import type { Notification, NotificationChannel, NotificationStatus } from './entities.js';

export interface CreateNotificationInput {
  userId: string;
  channel: NotificationChannel;
  type: string;
  payload: Record<string, unknown>;
}

export interface ListNotificationsFilter {
  status?: NotificationStatus;
  limit: number;
  /** Cursor for keyset pagination — only rows strictly older than this
   * timestamp are returned, so the response's `nextCursor` (the oldest
   * row's `createdAt`) can be fed back in to fetch the next page without
   * relying on an unstable `skip` offset. */
  before?: Date;
}

/**
 * The read/write model for this module's own `notifications` table —
 * unlike every read model elsewhere in this backend, these rows are not a
 * mirror of on-chain state (there is no `notification_*` contract event to
 * sync from); they're generated as a side effect of `dispatchNotificationsFromEvent`
 * reacting to *other* modules' on-chain events, then mutated by
 * `sendNotification` as delivery is attempted.
 */
export interface NotificationRepository {
  create(input: CreateNotificationInput): Promise<Notification>;
  findById(id: string): Promise<Notification | null>;
  listByUserId(userId: string, filter: ListNotificationsFilter): Promise<Notification[]>;
  markSent(id: string, sentAt: Date): Promise<void>;
  markFailed(id: string): Promise<void>;
}

export interface UserContact {
  userId: string;
  email: string;
}

/**
 * Resolves a linked Stellar wallet address (the only actor identifier any
 * blockchain event carries) to the local account that owns it, and that
 * account's contact email. This reaches into `users`' own `wallet_addresses`
 * table plus the shared `users` table directly — a deliberate exception to
 * every other module's "never touch another module's tables" convention,
 * on the same precedent `auth` and `users` already set by both reading the
 * `users` table directly: `schema.prisma`'s own `User.notifications`
 * relation field ties `Notification` to `User` at the schema level, and
 * identity (who owns which address, how to reach them) is shared substrate
 * here, not `users`-module-private domain state the way a `Delivery` or
 * `Escrow` row is. See `infrastructure/prisma-user-contact-lookup.ts`.
 *
 * Two lookup directions: `findByWalletAddress` resolves an on-chain actor
 * to an account at dispatch time (`dispatch-notifications-from-event.ts`);
 * `findByUserId` re-resolves that account's current email at send time
 * (`send-notification.ts`) rather than freezing it into the stored
 * `Notification` row, so an email address change between dispatch and
 * send (queued jobs can sit for a while under BullMQ's retry/backoff) is
 * honored.
 */
export interface UserContactLookup {
  findByWalletAddress(address: string): Promise<UserContact | null>;
  findByUserId(userId: string): Promise<UserContact | null>;
}

export interface NotificationEmailInput {
  to: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Channel delivery adapter — email only for v1 (`ARCHITECTURE.md` §4: SMS
 * and push are documented future work, not built here). Throws on any
 * failure (unconfigured channel, SMTP error) rather than silently
 * pretending success — `sendNotification` maps a throw to `FAILED`.
 */
export interface NotificationSender {
  send(input: NotificationEmailInput): Promise<void>;
}

/**
 * Producer-side handle onto the `notifications` BullMQ queue
 * (`src/shared/queue/queues.ts`) — enqueues one delivery job per row
 * `dispatchNotificationsFromEvent` creates, consumed by the worker-side
 * processor `infrastructure/queue.ts` wires up around `sendNotification`.
 */
export interface NotificationJobScheduler {
  enqueueDelivery(notificationId: string): Promise<void>;
}

export interface DeliveryParties {
  sender: string;
  recipient: string;
  driver: string | null;
}

/**
 * Resolves a delivery's other parties (sender/recipient/driver addresses)
 * from `deliveries`' own read-model table — the same documented,
 * `ARCHITECTURE.md`-sanctioned cross-module read exception `UserContactLookup`
 * above already establishes for this module, and the same precedent
 * `analytics`/`admin` rely on for their own read-model access
 * (`analytics/domain/ports.ts`, `admin/domain/ports.ts`).
 *
 * Exists so counterparty-facing events — `delivery_confirmed`,
 * `delivery_cancelled`, `DeliveryInTransit`, `escrow_refunded`, and the
 * three `dispute_resolved_*` events — can notify the sender/driver even
 * though none of those events carries a useful address of its own in its
 * payload (see `dispatch-notifications-from-event.ts`'s header comment).
 * `recipient` is exposed for completeness with `Delivery`'s own shape but
 * deliberately never used as a notification target today: every event this
 * port serves is one where the recipient is either the acting party
 * (`delivery_confirmed`) or not a documented interested party for that
 * event, so only `sender`/`driver` are ever candidates in practice.
 */
export interface DeliveryPartyLookup {
  findParties(chainDeliveryId: string): Promise<DeliveryParties | null>;
}
