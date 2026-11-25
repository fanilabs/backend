import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseAddress, parseBigIntId } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type {
  DeliveryParties,
  DeliveryPartyLookup,
  NotificationEventType,
  NotificationJobScheduler,
  NotificationPreferenceRepository,
  NotificationRepository,
  UserContactLookup,
} from '../domain/index.js';

const log = logger.child({ module: 'dispatch-notifications-from-event' });

export interface DispatchNotificationsFromEventDeps {
  notificationRepository: NotificationRepository;
  userContactLookup: UserContactLookup;
  deliveryPartyLookup: DeliveryPartyLookup;
  jobScheduler: NotificationJobScheduler;
  /** Optional — when omitted, all notifications are created (default-on
   * behavior preserved for callers that don't wire up preferences). */
  notificationPreferenceRepository?: NotificationPreferenceRepository;
}

interface NotificationCandidate {
  address: string;
  type: string;
  /** The corresponding preference enum key — `null` for event types that
   * have no preference gate (should not happen in practice, but handled
   * defensively so a missing mapping never blocks a notification). */
  eventType: NotificationEventType | null;
  payload: Record<string, unknown>;
}

/**
 * Maps the `type` string a notification row carries (e.g.
 * `"delivery.driver_assigned"`) to the `NotificationEventType` enum value
 * stored in `notification_preferences` (#698). The mapping is intentionally
 * exhaustive over all types `resolveCandidates` can produce — TypeScript
 * will catch a missing branch if a new type is added to one place but not
 * the other.
 */
const TYPE_TO_EVENT_TYPE: Record<string, NotificationEventType> = {
  'delivery.driver_assigned': 'DELIVERY_DRIVER_ASSIGNED',
  'delivery.DeliveryInTransit': 'DELIVERY_IN_TRANSIT',
  'delivery.delivery_confirmed': 'DELIVERY_CONFIRMED',
  'delivery.delivery_cancelled': 'DELIVERY_CANCELLED',
  'escrow.delivery_disputed': 'ESCROW_DELIVERY_DISPUTED',
  'escrow.escrow_released': 'ESCROW_RELEASED',
  'escrow.escrow_refunded': 'ESCROW_REFUNDED',
  'dispute.dispute_raised': 'DISPUTE_RAISED',
  'dispute.dispute_resolved_refund': 'DISPUTE_RESOLVED_REFUND',
  'dispute.dispute_resolved_split': 'DISPUTE_RESOLVED_SPLIT',
  'dispute.dispute_resolved_payout': 'DISPUTE_RESOLVED_PAYOUT',
  'reputation.driver_registered': 'REPUTATION_DRIVER_REGISTERED',
  'reputation.kyc_status_updated': 'REPUTATION_KYC_STATUS_UPDATED',
  'reputation.reputation_increased': 'REPUTATION_INCREASED',
  'reputation.reputation_decreased': 'REPUTATION_DECREASED',
  'fleet.fleet_registered': 'FLEET_REGISTERED',
  'fleet.driver_invited': 'FLEET_DRIVER_INVITED',
  'fleet.invite_accepted': 'FLEET_INVITE_ACCEPTED',
  'fleet.driver_removed': 'FLEET_DRIVER_REMOVED',
};

/**
 * Reacts to the same in-process event bus every other module subscribes to
 * (`src/shared/events`), turning a handful of on-chain events into
 * `Notification` rows for whichever actor address (or, since #101, resolved
 * counterparty) the event names — never every event across all five tracked
 * contracts.
 *
 * **Scope, per event group:**
 *  - Events with a directly-usable address in the topic/payload —
 *    `driver_assigned`, `escrow.delivery_disputed`, `escrow.escrow_released`,
 *    `dispute-resolution.dispute_raised`, all four `identity-reputation`
 *    events, five of `fleet`'s events — notify that address directly, same
 *    as before #101.
 *  - `delivery_confirmed`, `delivery_cancelled`, `DeliveryInTransit`,
 *    `escrow_refunded`, and the three `dispute_resolved_*` events carry only
 *    a `delivery_id` (or, for the dispute-resolution events, the resolving
 *    admin's own address alongside it) — no useful counterparty address of
 *    their own. These now resolve the sender/driver via
 *    `DeliveryPartyLookup`, which reaches into `deliveries`' own read-model
 *    table for exactly that purpose (`domain/ports.ts` header comment) —
 *    previously undone entirely, since resolving the counterparty was
 *    treated as out of scope; see #101/#96.
 *  - The resolving admin's own address (`dispute_resolved_*`'s `payload[0]`)
 *    is excluded from the resulting candidates, so the acting admin is never
 *    notified of their own action.
 *  - `delivery_created` (payload is `(delivery_id, sender)`) still resolves
 *    to nothing: notifying the actor of their own just-submitted action adds
 *    nothing, and unlike the group above there is no *other* party (driver
 *    isn't assigned yet) worth telling instead.
 *  - The escrow-layer `dispute_resolved` remains excluded — ambiguous
 *    between release/refund by itself (see `escrow`'s own sync handler),
 *    same reasoning `disputes` already documents for not handling it either.
 *  - `escrow_funded`'s payload contents beyond "no driver/token" aren't
 *    documented anywhere this codebase can verify against, so it's treated
 *    the same as "no address" rather than guessed at.
 *
 * **Preference gate (#698):**
 *  When `notificationPreferenceRepository` is supplied, dispatch consults
 *  the user's stored preference for each candidate's event type before
 *  creating a row. A `disabled: true` preference silently skips both row
 *  creation and job scheduling for that (user, eventType) pair. Missing
 *  preferences default to enabled — only an explicit `disabled: true` row
 *  suppresses the notification.
 *
 * A candidate address with no linked+verified local account is silently
 * skipped, not an error — not every on-chain actor necessarily has an
 * account on this backend. Duplicate addresses within one event (e.g. a
 * delivery whose sender and driver happen to resolve to the same account)
 * are only notified once.
 */
export function createDispatchNotificationsFromEventUseCase(
  deps: DispatchNotificationsFromEventDeps,
) {
  return async function dispatchNotificationsFromEvent(
    event: BlockchainEventEnvelope,
  ): Promise<void> {
    const candidates = await resolveCandidates(event, deps.deliveryPartyLookup);
    if (candidates.length === 0) return;

    const notifiedAddresses = new Set<string>();

    for (const candidate of candidates) {
      if (notifiedAddresses.has(candidate.address)) continue;
      notifiedAddresses.add(candidate.address);

      const contact = await deps.userContactLookup.findByWalletAddress(candidate.address);
      if (!contact) continue;

      // Check per-user preference before creating a row (#698).
      if (
        deps.notificationPreferenceRepository &&
        candidate.eventType !== null
      ) {
        const suppressed = await deps.notificationPreferenceRepository.isDisabled(
          contact.userId,
          candidate.eventType,
        );
        if (suppressed) continue;
      }

      const notification = await deps.notificationRepository.create({
        userId: contact.userId,
        channel: 'EMAIL',
        type: candidate.type,
        payload: candidate.payload,
      });

      try {
        await deps.jobScheduler.enqueueDelivery(notification.id);
      } catch (error: unknown) {
        log.error(
          { err: error, notificationId: notification.id },
          'Failed to enqueue notification delivery job',
        );
      }
    }
  };
}

/** Sender and driver are the only interested parties any covered event
 * resolves a notification for today — see `DeliveryPartyLookup`'s header
 * comment for why `recipient` is never a target even though it's part of
 * the resolved shape. `excludeAddress` drops the acting admin from
 * `dispute_resolved_*`; harmless no-op for events with no acting address. */
function partyCandidates(
  parties: DeliveryParties,
  type: string,
  payload: Record<string, unknown>,
  excludeAddress?: string | null,
): NotificationCandidate[] {
  return [parties.sender, parties.driver]
    .filter((address): address is string => address !== null && address !== excludeAddress)
    .map((address) => ({
      address,
      type,
      eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
      payload,
    }));
}

async function resolveCandidates(
  event: BlockchainEventEnvelope,
  deliveryPartyLookup: DeliveryPartyLookup,
): Promise<NotificationCandidate[]> {
  const payload = Array.isArray(event.payload) ? event.payload : [];

  switch (event.contractName) {
    case 'delivery': {
      const eventName = event.topic[0];

      if (eventName === 'driver_assigned') {
        const chainDeliveryId = parseId(payload[0]);
        const driverAddress = parseAddress(payload[1]);
        if (chainDeliveryId === null || driverAddress === null) return [];
        const type = 'delivery.driver_assigned';
        return [
          {
            address: driverAddress,
            type,
            eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
            payload: { chainDeliveryId },
          },
        ];
      }

      if (
        eventName === 'DeliveryInTransit' ||
        eventName === 'delivery_confirmed' ||
        eventName === 'delivery_cancelled'
      ) {
        const chainDeliveryId = parseId(payload[0]);
        if (chainDeliveryId === null) return [];
        const parties = await deliveryPartyLookup.findParties(chainDeliveryId);
        if (!parties) return [];
        return partyCandidates(parties, `delivery.${eventName}`, { chainDeliveryId });
      }

      return [];
    }

    case 'escrow': {
      const chainDeliveryId = parseId(event.topic[1]);
      if (chainDeliveryId === null) return [];

      if (event.topic[0] === 'delivery_disputed') {
        const disputedBy = parseAddress(payload[0]);
        if (disputedBy === null) return [];
        const type = 'escrow.delivery_disputed';
        return [
          {
            address: disputedBy,
            type,
            eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
            payload: { chainDeliveryId },
          },
        ];
      }

      if (event.topic[0] === 'escrow_released') {
        // Payload is `(driver, payout, fee)` — verified against
        // `EVENT_INDEXER.md`'s own documentation of this event, written
        // while building the `escrow` module.
        const driverAddress = parseAddress(payload[0]);
        if (driverAddress === null) return [];
        const type = 'escrow.escrow_released';
        return [
          {
            address: driverAddress,
            type,
            eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
            payload: { chainDeliveryId },
          },
        ];
      }

      if (event.topic[0] === 'escrow_refunded') {
        const parties = await deliveryPartyLookup.findParties(chainDeliveryId);
        if (!parties) return [];
        return partyCandidates(parties, 'escrow.escrow_refunded', { chainDeliveryId });
      }

      return [];
    }

    case 'dispute-resolution': {
      const eventName = event.topic[0];

      if (eventName === 'dispute_raised') {
        const chainDeliveryId = parseTupleWrappedId(event.topic[1]);
        const raisedBy = parseAddress(payload[0]);
        if (chainDeliveryId === null || raisedBy === null) return [];
        const type = 'dispute.dispute_raised';
        return [
          {
            address: raisedBy,
            type,
            eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
            payload: { chainDeliveryId },
          },
        ];
      }

      if (
        eventName === 'dispute_resolved_refund' ||
        eventName === 'dispute_resolved_split' ||
        eventName === 'dispute_resolved_payout'
      ) {
        const chainDeliveryId = parseTupleWrappedId(event.topic[1]);
        if (chainDeliveryId === null) return [];
        const resolvingAdmin = parseAddress(payload[0]);
        const parties = await deliveryPartyLookup.findParties(chainDeliveryId);
        if (!parties) return [];
        return partyCandidates(parties, `dispute.${eventName}`, { chainDeliveryId }, resolvingAdmin);
      }

      return [];
    }

    case 'identity-reputation': {
      const eventName = event.topic[0];
      if (
        eventName !== 'driver_registered' &&
        eventName !== 'kyc_status_updated' &&
        eventName !== 'reputation_increased' &&
        eventName !== 'reputation_decreased'
      ) {
        return [];
      }
      const driverAddress = parseAddress(payload[0]);
      if (driverAddress === null) return [];
      const type = `reputation.${eventName}`;
      return [
        {
          address: driverAddress,
          type,
          eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
          payload: {},
        },
      ];
    }

    case 'fleet': {
      const eventName = event.topic[0];
      const chainFleetId = parseId(payload[0]);
      if (chainFleetId === null) return [];

      if (eventName === 'fleet_registered') {
        const ownerAddress = parseAddress(payload[1]);
        if (ownerAddress === null) return [];
        const type = 'fleet.fleet_registered';
        return [
          {
            address: ownerAddress,
            type,
            eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
            payload: { chainFleetId },
          },
        ];
      }

      if (
        eventName === 'driver_invited' ||
        eventName === 'invite_accepted' ||
        eventName === 'driver_removed'
      ) {
        const driverAddress = parseAddress(payload[1]);
        if (driverAddress === null) return [];
        const type = `fleet.${eventName}`;
        return [
          {
            address: driverAddress,
            type,
            eventType: TYPE_TO_EVENT_TYPE[type] ?? null,
            payload: { chainFleetId },
          },
        ];
      }

      return [];
    }

    default:
      return [];
  }
}

/** Same numeric encoding as {@link parseBigIntId}, but notifications keys its
 * read model by the decimal *string* form of the id. */
function parseId(value: unknown): string | null {
  const parsed = parseBigIntId(value);
  return parsed === null ? null : parsed.toString();
}

/** `dispute_resolution_contract`'s tuple-wrapped `DeliveryId` arrives as the
 * JSON string `'["1"]'` in a topic segment — see `disputes`' own
 * `sync-dispute-from-event.ts` header comment for the full explanation. */
function parseTupleWrappedId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  return parseId(parsed[0]);
}
