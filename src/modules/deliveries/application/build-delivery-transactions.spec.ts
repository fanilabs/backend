import { describe, expect, it } from 'vitest';
import { createBuildDeliveryTransactionsUseCases } from './build-delivery-transactions.js';
import { createFakeDeliveryTransactionBuilder } from './__fixtures__/fakes.js';

describe('buildDeliveryTransactions use cases', () => {
  it('delegates each build call to the transaction builder port', async () => {
    const transactionBuilder = createFakeDeliveryTransactionBuilder();
    const useCases = createBuildDeliveryTransactionsUseCases({ transactionBuilder });

    await expect(
      useCases.buildCreateDeliveryTransaction({
        senderAddress: 'GA',
        recipientAddress: 'GB',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 100,
        fragile: false,
        estimatedDelivery: new Date(),
      }),
    ).resolves.toBe('unsigned-xdr:create-delivery');

    await expect(
      useCases.buildAssignDriverTransaction({
        callerAddress: 'GA',
        chainDeliveryId: 1n,
        driverAddress: 'GC',
      }),
    ).resolves.toBe('unsigned-xdr:assign-driver');

    await expect(
      useCases.buildMarkInTransitTransaction({ driverAddress: 'GC', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:mark-in-transit');

    await expect(
      useCases.buildConfirmDeliveryTransaction({ recipientAddress: 'GB', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:confirm-delivery');

    await expect(
      useCases.buildCancelDeliveryTransaction({ senderAddress: 'GA', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:cancel-delivery');

    await expect(
      useCases.buildRaiseDisputeTransaction({ callerAddress: 'GA', chainDeliveryId: 1n }),
    ).resolves.toBe('unsigned-xdr:raise-dispute');
  });
});
