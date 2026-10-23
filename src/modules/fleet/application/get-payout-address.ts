import type { FleetContractReader } from '../domain/index.js';

export interface GetPayoutAddressDeps {
  contractReader: FleetContractReader;
  cacheTtlMs?: number;
}

export interface GetPayoutAddressInput {
  chainFleetId: bigint;
  driverAddress: string;
}

const DEFAULT_PAYOUT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Creates a use case that reads a driver's payout address from the fleet
 * contract with an in-memory 5-minute TTL cache (#397) so repeated lookups
 * do not exhaust Soroban RPC simulation quotas.
 */
export function createGetPayoutAddressUseCase(deps: GetPayoutAddressDeps) {
  const ttlMs = deps.cacheTtlMs ?? DEFAULT_PAYOUT_CACHE_TTL_MS;
  const cache = new Map<string, { payoutAddress: string; expiresAt: number }>();

  return async function getPayoutAddress(input: GetPayoutAddressInput): Promise<string> {
    const key = `${input.chainFleetId.toString()}:${input.driverAddress}`;
    const now = Date.now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.payoutAddress;
    }

    const payoutAddress = await deps.contractReader.getPayoutAddress(
      input.driverAddress,
      input.chainFleetId,
    );
    if (ttlMs > 0) {
      cache.set(key, { payoutAddress, expiresAt: now + ttlMs });
    }
    return payoutAddress;
  };
}
