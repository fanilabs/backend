import { describe, expect, it } from 'vitest';
import { createBuildEscrowTransactionsUseCases } from './build-escrow-transactions.js';
import { createFakeEscrowTransactionBuilder } from './__fixtures__/fakes.js';

describe('buildEscrowTransactions use cases', () => {
  it('delegates each build call to the transaction builder port', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildCreateEscrowTransaction({
        senderAddress: 'GA',
        recipientAddress: 'GB',
        driverAddress: 'GC',
        chainDeliveryId: 1n,
        token: 'GTOKEN',
        amount: 1000n,
      }),
    ).resolves.toBe('unsigned-xdr:create-escrow');

    await expect(
      useCases.buildReleaseEscrowTransaction({ callerAddress: 'GB', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:release-escrow');

    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: 'GA', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:refund-escrow');
  });
});
