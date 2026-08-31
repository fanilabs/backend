import { describe, expect, it } from 'vitest';
import { createBuildDisputeTransactionsUseCases } from './build-dispute-transactions.js';
import { createFakeDisputeTransactionBuilder, createInMemoryDisputeRepository } from './__fixtures__/fakes.js';

describe('createBuildDisputeTransactionsUseCases', () => {
  it('delegates every call to the DisputeTransactionBuilder port', async () => {
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
    });

    await expect(
      useCases.buildRaiseDisputeTransaction({ callerAddress: 'GSENDER', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:raise-dispute');

    await expect(
      useCases.buildAddEvidenceHashTransaction({
        callerAddress: 'GSENDER',
        chainDeliveryId: 1n,
        evidenceHash: 'aa'.repeat(32),
      }),
    ).resolves.toBe('unsigned-xdr:add-evidence-hash');

    await expect(
      useCases.buildResolveDisputeRefundSenderTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-refund-sender');

    await expect(
      useCases.buildResolveDisputePayDriverTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-pay-driver');

    await expect(
      useCases.buildResolveDisputeSplitFundsTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
        senderShareBps: 5000,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-split-funds');
  });

  it('buildResolveDisputeSplitFundsTransaction: records senderShareBps as proposed value (issue #40)', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
      disputeRepository,
    });

    const result = await useCases.buildResolveDisputeSplitFundsTransaction({
      callerAddress: 'GADMIN',
      chainDeliveryId: 1n,
      senderShareBps: 7500,
    });

    expect(result).toBe('unsigned-xdr:resolve-dispute-split-funds');
    const dispute = await disputeRepository.findByChainDeliveryId(1n);
    expect(dispute?.senderShareBps).toBe(7500);
  });
});
