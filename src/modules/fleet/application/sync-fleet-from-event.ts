import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseAddress, parseBigIntId } from '../../../shared/events/index.js';
import type { FleetRepository } from '../domain/index.js';

export interface SyncFleetFromEventDeps {
  fleetRepository: FleetRepository;
}

/**
 * Reacts to `fleet_management_contract` events. Every `publish()` call in
 * `contracts/fleet_management_contract/lib.rs` uses a single-segment topic
 * (`(Symbol,)`) with `fleet_id` as the *first payload element* — the same
 * convention `delivery_contract` uses, and the opposite of `escrow_contract`
 * (which puts the id in the topic). Verified directly against that file
 * before writing this, not assumed.
 *
 * Unlike deliveries/escrow, no event here has a sparse payload that needs a
 * supplementary read call — `fleet_registered`/`fleet_treasury_updated`
 * carry `(fleet_id, owner, treasury)` and `driver_invited`/
 * `invite_accepted`/`driver_removed` carry `(fleet_id, driver)`, which is
 * everything each handler needs. No `FleetContractReader` dependency here
 * as a result — see that port's header comment for what it's for instead.
 */
export function createSyncFleetFromEventUseCase(deps: SyncFleetFromEventDeps) {
  return async function syncFleetFromEvent(event: BlockchainEventEnvelope): Promise<void> {
    if (event.contractName !== 'fleet') {
      return;
    }

    const eventName = event.topic[0];
    const payload = Array.isArray(event.payload) ? event.payload : [];
    const chainFleetId = parseBigIntId(payload[0]);
    if (chainFleetId === null) return;

    switch (eventName) {
      case 'fleet_registered': {
        const ownerAddress = parseAddress(payload[1]);
        const treasuryAddress = parseAddress(payload[2]);
        if (ownerAddress === null || treasuryAddress === null) return;
        await deps.fleetRepository.create({ chainFleetId, ownerAddress, treasuryAddress });
        return;
      }

      case 'fleet_treasury_updated': {
        const treasuryAddress = parseAddress(payload[2]);
        if (treasuryAddress === null) return;
        await deps.fleetRepository.updateTreasury(chainFleetId, treasuryAddress);
        return;
      }

      case 'driver_invited': {
        const driverAddress = parseAddress(payload[1]);
        if (driverAddress === null) return;
        await deps.fleetRepository.inviteDriver(chainFleetId, driverAddress, event.closedAt);
        return;
      }

      case 'invite_accepted': {
        const driverAddress = parseAddress(payload[1]);
        if (driverAddress === null) return;
        await deps.fleetRepository.acceptInvite(chainFleetId, driverAddress, event.closedAt);
        return;
      }

      case 'driver_removed': {
        const driverAddress = parseAddress(payload[1]);
        if (driverAddress === null) return;
        await deps.fleetRepository.removeDriver(chainFleetId, driverAddress, event.closedAt);
        return;
      }

      default:
        // A future addition this handler doesn't know about yet — ignored,
        // not an error (docs/EVENT_INDEXER.md's malformed/unknown-event
        // handling).
        return;
    }
  };
}
