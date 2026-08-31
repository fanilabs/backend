import { describe, expect, it } from 'vitest';
import { createGetPayoutAddressUseCase } from './get-payout-address.js';
import { createFakeFleetContractReader } from './__fixtures__/fakes.js';

describe('getPayoutAddress', () => {
  it('delegates to the contract reader (a live RPC read, not a DB lookup)', async () => {
    const contractReader = createFakeFleetContractReader();
    contractReader.seedPayoutAddress('GDRIVER', 1n, 'GTREASURY');

    const getPayoutAddress = createGetPayoutAddressUseCase({ contractReader });
    const result = await getPayoutAddress({ chainFleetId: 1n, driverAddress: 'GDRIVER' });

    expect(result).toBe('GTREASURY');
  });
});
