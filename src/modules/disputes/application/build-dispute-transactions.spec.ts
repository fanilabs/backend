import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../../shared/errors/index.js';
import { createBuildDisputeTransactionsUseCases } from './build-dispute-transactions.js';
import {
  buildDispute,
  createFakeDisputeTransactionBuilder,
  createInMemoryDisputeRepository,
} from './__fixtures__/fakes.js';

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

  it('buildResolveDisputeSplitFundsTransaction: preserves the 10000-bps split and rejects out-of-range shares', async () => {
    const transactionBuilder = createFakeDisputeTransactionBuilder();
    const buildSplitFunds = vi.spyOn(transactionBuilder, 'buildResolveDisputeSplitFunds');
    const useCases = createBuildDisputeTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildResolveDisputeSplitFundsTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 1n,
        senderShareBps: 5000,
      }),
    ).resolves.toBe('unsigned-xdr:resolve-dispute-split-funds');

    const builtInput = buildSplitFunds.mock.calls[0]?.[0];
    expect(builtInput?.senderShareBps).toBe(5000);
    expect(10_000 - (builtInput?.senderShareBps ?? 0)).toBe(5000);

    await expect(
      useCases.buildResolveDisputeSplitFundsTransaction({
        callerAddress: 'GADMIN',
        chainDeliveryId: 2n,
        senderShareBps: 12_000,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(buildSplitFunds).toHaveBeenCalledTimes(1);
  });

  it('buildResolveDisputeSplitFundsTransaction: records the proposed value without touching an existing dispute\'s other fields', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    disputeRepository.seed(
      buildDispute({ chainDeliveryId: 5n, status: 'OPEN', raisedBy: 'GORIGINAL' }),
    );
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
      disputeRepository,
    });

    await useCases.buildResolveDisputeSplitFundsTransaction({
      callerAddress: 'GADMIN',
      chainDeliveryId: 5n,
      senderShareBps: 4000,
    });

    const dispute = await disputeRepository.findByChainDeliveryId(5n);
    expect(dispute).toMatchObject({ status: 'OPEN', raisedBy: 'GORIGINAL', senderShareBps: 4000 });
  });

  it('buildResolveDisputeSplitFundsTransaction: never overwrites an already-resolved dispute\'s confirmed senderShareBps', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    disputeRepository.seed(
      buildDispute({ chainDeliveryId: 6n, status: 'SPLIT', senderShareBps: 7500 }),
    );
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
      disputeRepository,
    });

    await useCases.buildResolveDisputeSplitFundsTransaction({
      callerAddress: 'GADMIN',
      chainDeliveryId: 6n,
      senderShareBps: 1000,
    });

    const dispute = await disputeRepository.findByChainDeliveryId(6n);
    expect(dispute?.senderShareBps).toBe(7500);
  });

  it('buildResolveDisputeSplitFundsTransaction: does not write when dispute is RESOLVED_REFUND', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    disputeRepository.seed(
      buildDispute({ chainDeliveryId: 7n, status: 'RESOLVED_REFUND', senderShareBps: null }),
    );
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
      disputeRepository,
    });

    // Even though the builder succeeds, recordProposedSenderShareBps is
    // always a no-op for resolved disputes
    await useCases.buildResolveDisputeSplitFundsTransaction({
      callerAddress: 'GADMIN',
      chainDeliveryId: 7n,
      senderShareBps: 5000,
    });

    const dispute = await disputeRepository.findByChainDeliveryId(7n);
    expect(dispute?.senderShareBps).toBeNull();
  });

  it('buildResolveDisputeSplitFundsTransaction: does not write when dispute is RESOLVED_PAYOUT', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    disputeRepository.seed(
      buildDispute({ chainDeliveryId: 8n, status: 'RESOLVED_PAYOUT', senderShareBps: null }),
    );
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
      disputeRepository,
    });

    await useCases.buildResolveDisputeSplitFundsTransaction({
      callerAddress: 'GADMIN',
      chainDeliveryId: 8n,
      senderShareBps: 2500,
    });

    const dispute = await disputeRepository.findByChainDeliveryId(8n);
    expect(dispute?.senderShareBps).toBeNull();
  });

  it('buildResolveDisputeSplitFundsTransaction: records proposed value only when dispute is OPEN', async () => {
    const disputeRepository = createInMemoryDisputeRepository();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 9n, status: 'OPEN', senderShareBps: null }));
    const useCases = createBuildDisputeTransactionsUseCases({
      transactionBuilder: createFakeDisputeTransactionBuilder(),
      disputeRepository,
    });

    await useCases.buildResolveDisputeSplitFundsTransaction({
      callerAddress: 'GADMIN',
      chainDeliveryId: 9n,
      senderShareBps: 3333,
    });

    const dispute = await disputeRepository.findByChainDeliveryId(9n);
    expect(dispute?.status).toBe('OPEN');
    expect(dispute?.senderShareBps).toBe(3333);
  });
});
