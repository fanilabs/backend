import { describe, expect, it, vi } from 'vitest';
import { createBuildEscrowTransactionsUseCases } from './build-escrow-transactions.js';
import { createFakeEscrowTransactionBuilder } from './__fixtures__/fakes.js';
import { InvalidEscrowStateError } from '../domain/errors.js';

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

  it('rejects create escrow transaction build with amount: 0n', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildCreateEscrowTransaction({
        senderAddress: 'GA',
        recipientAddress: 'GB',
        driverAddress: 'GC',
        chainDeliveryId: 1n,
        token: 'GTOKEN',
        amount: 0n,
      }),
    ).rejects.toThrow('Escrow amount must be greater than zero');
  });

  it('rejects create escrow transaction build with amount: -100n', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildCreateEscrowTransaction({
        senderAddress: 'GA',
        recipientAddress: 'GB',
        driverAddress: 'GC',
        chainDeliveryId: 1n,
        token: 'GTOKEN',
        amount: -100n,
      }),
    ).rejects.toThrow('Escrow amount must be greater than zero');
  });

  it('succeeds create escrow transaction build with amount: 10000000n', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildCreateEscrowTransaction({
        senderAddress: 'GA',
        recipientAddress: 'GB',
        driverAddress: 'GC',
        chainDeliveryId: 1n,
        token: 'GTOKEN',
        amount: 10_000_000n,
      }),
    ).resolves.toBe('unsigned-xdr:create-escrow');
  });

  it('builds a refund transaction for a LOCKED escrow', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const getEscrowStatus = vi.fn(async (_chainDeliveryId: bigint) => 'LOCKED' as const);
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder, getEscrowStatus });

    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: 'GA', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:refund-escrow');
  });

  it('builds a refund transaction for a PAUSED escrow', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const getEscrowStatus = vi.fn(async (_chainDeliveryId: bigint) => 'PAUSED' as const);
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder, getEscrowStatus });

    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: 'GA', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:refund-escrow');
  });

  it('rejects refund transaction build for a RELEASED escrow', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const getEscrowStatus = vi.fn(async (_chainDeliveryId: bigint) => 'RELEASED' as const);
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder, getEscrowStatus });

    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: 'GA', chainDeliveryId: 1n }),
    ).rejects.toBeInstanceOf(InvalidEscrowStateError);
  });

  it('rejects refund transaction build for a REFUNDED escrow', async () => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const getEscrowStatus = vi.fn(async (_chainDeliveryId: bigint) => 'REFUNDED' as const);
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder, getEscrowStatus });

    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: 'GA', chainDeliveryId: 1n }),
    ).rejects.toThrow('Escrow cannot be refunded in current status');
  });
});
