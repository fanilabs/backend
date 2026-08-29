import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type {
  DeliveryParties,
  DeliveryPartyLookup,
  NotificationJobScheduler,
  NotificationRepository,
  UserContactLookup,
} from '../domain/index.js';

const log = logger.child({ module: 'dispatch-notifications-from-event' });

export interface DispatchNotificationsFromEventDeps {
  notificationRepository: NotificationRepository;
  userContactLookup: UserContactLookup;
  deliveryPartyLookup: DeliveryPartyLookup;
  jobScheduler: NotificationJobScheduler;
}

interface NotificationCandidate {
  address: string;
  type: string;
  payload: Record<string, unknown>;
}

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
    .map((address) => ({ address, type, payload }));
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
        return [
          { address: driverAddress, type: 'delivery.driver_assigned', payload: { chainDeliveryId } },
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
        return [
          { address: disputedBy, type: 'escrow.delivery_disputed', payload: { chainDeliveryId } },
        ];
      }

      if (event.topic[0] === 'escrow_released') {
        // Payload is `(driver, payout, fee)` — verified against
        // `EVENT_INDEXER.md`'s own documentation of this event, written
        // while building the `escrow` module.
        const driverAddress = parseAddress(payload[0]);
        if (driverAddress === null) return [];
        return [
          { address: driverAddress, type: 'escrow.escrow_released', payload: { chainDeliveryId } },
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
        return [{ address: raisedBy, type: 'dispute.dispute_raised', payload: { chainDeliveryId } }];
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
      return [{ address: driverAddress, type: `reputation.${eventName}`, payload: {} }];
    }

    case 'fleet': {
      const eventName = event.topic[0];
      const chainFleetId = parseId(payload[0]);
      if (chainFleetId === null) return [];

      if (eventName === 'fleet_registered') {
        const ownerAddress = parseAddress(payload[1]);
        if (ownerAddress === null) return [];
        return [
          { address: ownerAddress, type: 'fleet.fleet_registered', payload: { chainFleetId } },
        ];
      }

      if (
        eventName === 'driver_invited' ||
        eventName === 'invite_accepted' ||
        eventName === 'driver_removed'
      ) {
        const driverAddress = parseAddress(payload[1]);
        if (driverAddress === null) return [];
        return [{ address: driverAddress, type: `fleet.${eventName}`, payload: { chainFleetId } }];
      }

      return [];
    }

    default:
      return [];
  }
}

function parseId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
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

function parseAddress(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
