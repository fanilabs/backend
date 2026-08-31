import { describe, expect, it } from 'vitest';
import { createBuildFleetTransactionsUseCases } from './build-fleet-transactions.js';
import { createFakeFleetTransactionBuilder } from './__fixtures__/fakes.js';

describe('buildFleetTransactions use cases', () => {
  it('delegates each build call to the transaction builder port', async () => {
    const transactionBuilder = createFakeFleetTransactionBuilder();
    const useCases = createBuildFleetTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildRegisterFleetTransaction({ ownerAddress: 'GA', treasuryAddress: 'GB' }),
    ).resolves.toBe('unsigned-xdr:register-fleet');

    await expect(
      useCases.buildUpdateFleetTreasuryTransaction({
        ownerAddress: 'GA',
        chainFleetId: 1n,
        treasuryAddress: 'GC',
      }),
    ).resolves.toBe('unsigned-xdr:update-fleet-treasury');

    await expect(
      useCases.buildAddDriverToFleetTransaction({
        callerAddress: 'GA',
        chainFleetId: 1n,
        driverAddress: 'GD',
      }),
    ).resolves.toBe('unsigned-xdr:add-driver-to-fleet');

    await expect(
      useCases.buildAcceptFleetInviteTransaction({ chainFleetId: 1n, driverAddress: 'GD' }),
    ).resolves.toBe('unsigned-xdr:accept-fleet-invite');

    await expect(
      useCases.buildRemoveDriverFromFleetTransaction({
        callerAddress: 'GA',
        chainFleetId: 1n,
        driverAddress: 'GD',
      }),
    ).resolves.toBe('unsigned-xdr:remove-driver-from-fleet');
  });
});
