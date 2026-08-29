import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { logger } from '../../../shared/logger/index.js';
import type {
  DriverProfileRepository,
  DriverProfileUpsertFields,
  LegacyDriverProfileReader,
  ReputationContractReader,
} from '../domain/index.js';
import { tierFromScore } from '../domain/index.js';

const log = logger.child({ module: 'sync-reputation-from-event' });

export interface SyncReputationFromEventDeps {
  driverProfileRepository: DriverProfileRepository;
  contractReader: ReputationContractReader;
  legacyReader: LegacyDriverProfileReader;
}

/**
 * Reacts to `identity_reputation_contract` events (contractName
 * `identity-reputation`) — `driver_registered`, `kyc_status_updated`,
 * `reputation_increased`, `reputation_decreased`. Every one of these
 * payloads is genuinely too sparse to patch a read model incrementally
 * from (`reputation_increased`/`_decreased` carry only a caller/points
 * delta, never the resulting score — verified against
 * `identity_reputation_contract/lib.rs`), and this backend must not
 * reimplement the on-chain scoring formula itself (ROADMAP.md §13's "no
 * duplicated business logic" rule — a local copy of `+5+3+2`/cap-at-100
 * arithmetic would silently drift if the contract's formula ever changes).
 * So every one of these events triggers the same full refresh: a
 * supplementary `get_driver_profile` read call, same rationale as
 * `escrow`'s `escrow_funded`/`dispute_resolved` handlers.
 *
 * `user_registered` is intentionally a no-op — this module's schema
 * (frozen in Phase 4) has no read model for the on-chain `UserProfile` it
 * creates, only for driver reputation.
 *
 * `tier` has no on-chain event or field of its own — `get_driver_tier` is a
 * pure function of `reputationScore`, so it's recomputed here via
 * `tierFromScore` rather than fetched via yet another RPC call. The
 * threshold numbers themselves live in one named place —
 * `../domain/tier-thresholds.ts`'s `DRIVER_TIER_THRESHOLDS` — rather than
 * as inline literals here, specifically so a future contract-threshold
 * change is a one-file, reviewed edit instead of a silent drift risk.
 */
export function createSyncReputationFromEventUseCase(deps: SyncReputationFromEventDeps) {
  return async function syncReputationFromEvent(event: BlockchainEventEnvelope): Promise<void> {
    if (event.contractName !== 'identity-reputation') return;

    const eventName = event.topic[0];
    const payload = Array.isArray(event.payload) ? event.payload : [];

    switch (eventName) {
      case 'driver_registered':
      case 'kyc_status_updated':
      case 'reputation_increased':
      case 'reputation_decreased': {
        const driverAddress = parseAddress(payload[0]);
        if (driverAddress === null) return;
        await refreshDriverProfile(deps, driverAddress);
        return;
      }

      default:
        return;
    }
  };
}

async function refreshDriverProfile(
  deps: SyncReputationFromEventDeps,
  address: string,
): Promise<void> {
  const profile = await deps.contractReader.getDriverProfile(address);

  const fields: DriverProfileUpsertFields = {
    reputationScore: profile.reputationScore,
    tier: tierFromScore(profile.reputationScore),
    kycVerified: profile.kycVerified,
    deliveriesCompleted: profile.deliveriesCompleted,
    registeredAt: profile.registeredAt,
  };

  try {
    fields.legacyDeliveriesCompleted =
      await deps.legacyReader.getLegacyDeliveriesCompleted(address);
  } catch (error: unknown) {
    // delivery_contract not configured, unreachable, or has no local
    // DriverProfile for this driver yet — leave legacyDeliveriesCompleted
    // untouched (DriverProfileRepository.upsert preserves the prior value,
    // or Prisma's own column default on first insert) rather than
    // regressing a previously-known count to 0.
    log.debug({ err: error, address }, 'Legacy delivery_contract driver profile unavailable');
  }

  await deps.driverProfileRepository.upsert(address, fields);
}

function parseAddress(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
