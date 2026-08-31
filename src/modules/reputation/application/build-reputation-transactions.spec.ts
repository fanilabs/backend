import { describe, expect, it } from 'vitest';
import { createBuildReputationTransactionsUseCases } from './build-reputation-transactions.js';
import { createFakeReputationTransactionBuilder } from './__fixtures__/fakes.js';

describe('createBuildReputationTransactionsUseCases', () => {
  it('delegates every call to the ReputationTransactionBuilder port', async () => {
    const useCases = createBuildReputationTransactionsUseCases({
      transactionBuilder: createFakeReputationTransactionBuilder(),
    });

    await expect(
      useCases.buildRegisterDriverTransaction({ driverAddress: 'GDRIVER' }),
    ).resolves.toBe('unsigned-xdr:register-driver');

    await expect(
      useCases.buildUpdateDriverKycStatusTransaction({
        adminAddress: 'GADMIN',
        driverAddress: 'GDRIVER',
        kycVerified: true,
      }),
    ).resolves.toBe('unsigned-xdr:update-driver-kyc-status');
  });
});
