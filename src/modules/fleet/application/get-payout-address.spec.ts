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

  it('caches resolved payout addresses within the 5-minute TTL (#397)', async () => {
    let calls = 0;
    const contractReader = {
      async getFleet() {
        throw new Error('unused');
      },
      async getDriverFleetRecord() {
        throw new Error('unused');
      },
      async getPayoutAddress() {
        calls += 1;
        return 'GCACHED_PAYOUT';
      },
    };
    const getPayoutAddress = createGetPayoutAddressUseCase({ contractReader });
    const first = await getPayoutAddress({ chainFleetId: 1n, driverAddress: 'GDRIVER' });
    const second = await getPayoutAddress({ chainFleetId: 1n, driverAddress: 'GDRIVER' });
    expect(first).toBe('GCACHED_PAYOUT');
    expect(second).toBe('GCACHED_PAYOUT');
    expect(calls).toBe(1);
  });
});
