import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeToScVal, xdr } from '@stellar/stellar-sdk';
import {
  addressToScVal,
  buildInvokeTransaction,
  simulateReadCall,
  type SorobanClient,
} from '../../../blockchain/index.js';
import { createSorobanDeliveryContractClient } from './soroban-delivery-contract-client.js';
import { createDeliveryArgsToScVal, deliveryIdToScVal } from './delivery-scval-mapping.js';

vi.mock('../../../blockchain/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../blockchain/index.js')>();
  return {
    ...actual,
    buildInvokeTransaction: vi.fn(),
    simulateReadCall: vi.fn(),
  };
});

const CONTRACT_ID = 'CDELIVERYCONTRACTID0000000000000000000000000000000000000000';
const SENDER = 'GSENDERADDRESS000000000000000000000000000000000000000000';
const DRIVER = 'GDRIVERADDRESS000000000000000000000000000000000000000000';
const RECIPIENT = 'GRECIPIENTADDRESS00000000000000000000000000000000000000';
const CALLER = 'GCALLERADDRESS00000000000000000000000000000000000000000';
const CHAIN_DELIVERY_ID = 42n;
const UNSIGNED_XDR = 'AAAAAgAAAABunsigned-xdr-payload';

const client = {} as SorobanClient;

function decodeArgs(args: xdr.ScVal[]): unknown[] {
  return args.map((arg) => arg.value());
}

describe('createSorobanDeliveryContractClient', () => {
  const buildInvokeTransactionMock = vi.mocked(buildInvokeTransaction);

  beforeEach(() => {
    vi.clearAllMocks();
    buildInvokeTransactionMock.mockResolvedValue(UNSIGNED_XDR);
  });

  describe('buildCreateDelivery', () => {
    it('passes the expected contract method, source address and arguments', async () => {
      const input = {
        senderAddress: SENDER,
        recipientAddress: RECIPIENT,
        driverAddress: DRIVER,
        chainDeliveryId: CHAIN_DELIVERY_ID,
      } as Parameters<
        ReturnType<typeof createSorobanDeliveryContractClient>['buildCreateDelivery']
      >[0];

      const result = await createSorobanDeliveryContractClient(
        client,
        CONTRACT_ID,
      ).buildCreateDelivery(input);

      expect(result).toBe(UNSIGNED_XDR);
      expect(buildInvokeTransactionMock).toHaveBeenCalledTimes(1);
      const call = buildInvokeTransactionMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('create_delivery');
      expect(call.sourceAddress).toBe(SENDER);
      expect(call.args).toEqual(createDeliveryArgsToScVal(input));
    });

    it('propagates a rejection from the shared builder', async () => {
      const error = new Error('builder failed');
      buildInvokeTransactionMock.mockRejectedValueOnce(error);

      await expect(
        createSorobanDeliveryContractClient(client, CONTRACT_ID).buildCreateDelivery({
          senderAddress: SENDER,
          recipientAddress: RECIPIENT,
          driverAddress: DRIVER,
          chainDeliveryId: CHAIN_DELIVERY_ID,
        } as Parameters<
          ReturnType<typeof createSorobanDeliveryContractClient>['buildCreateDelivery']
        >[0]),
      ).rejects.toBe(error);
    });
  });

  describe('buildAssignDriver', () => {
    it('passes the expected contract method, source address and arguments', async () => {
      const result = await createSorobanDeliveryContractClient(
        client,
        CONTRACT_ID,
      ).buildAssignDriver({
        callerAddress: CALLER,
        chainDeliveryId: CHAIN_DELIVERY_ID,
        driverAddress: DRIVER,
      });

      expect(result).toBe(UNSIGNED_XDR);
      const call = buildInvokeTransactionMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('assign_driver');
      expect(call.sourceAddress).toBe(CALLER);
      expect(call.args).toEqual([
        addressToScVal(CALLER),
        deliveryIdToScVal(CHAIN_DELIVERY_ID),
        addressToScVal(DRIVER),
      ]);
    });
  });

  describe('buildMarkInTransit', () => {
    it('passes the expected contract method, source address and arguments', async () => {
      const result = await createSorobanDeliveryContractClient(
        client,
        CONTRACT_ID,
      ).buildMarkInTransit({
        driverAddress: DRIVER,
        chainDeliveryId: CHAIN_DELIVERY_ID,
      });

      expect(result).toBe(UNSIGNED_XDR);
      const call = buildInvokeTransactionMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('mark_in_transit');
      expect(call.sourceAddress).toBe(DRIVER);
      expect(call.args).toEqual([
        addressToScVal(DRIVER),
        deliveryIdToScVal(CHAIN_DELIVERY_ID),
      ]);
    });

    it('propagates a rejection from the shared builder', async () => {
      const error = new Error('builder failed');
      buildInvokeTransactionMock.mockRejectedValueOnce(error);

      await expect(
        createSorobanDeliveryContractClient(client, CONTRACT_ID).buildMarkInTransit({
          driverAddress: DRIVER,
          chainDeliveryId: CHAIN_DELIVERY_ID,
        }),
      ).rejects.toBe(error);
    });
  });

  describe('buildConfirmDelivery', () => {
    it('passes the expected contract method, source address and arguments', async () => {
      const result = await createSorobanDeliveryContractClient(
        client,
        CONTRACT_ID,
      ).buildConfirmDelivery({
        recipientAddress: RECIPIENT,
        chainDeliveryId: CHAIN_DELIVERY_ID,
      });

      expect(result).toBe(UNSIGNED_XDR);
      const call = buildInvokeTransactionMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('confirm_delivery');
      expect(call.sourceAddress).toBe(RECIPIENT);
      expect(call.args).toEqual([
        addressToScVal(RECIPIENT),
        deliveryIdToScVal(CHAIN_DELIVERY_ID),
      ]);
    });
  });

  describe('buildCancelDelivery', () => {
    it('passes the expected contract method, source address and arguments', async () => {
      const result = await createSorobanDeliveryContractClient(
        client,
        CONTRACT_ID,
      ).buildCancelDelivery({
        senderAddress: SENDER,
        chainDeliveryId: CHAIN_DELIVERY_ID,
      });

      expect(result).toBe(UNSIGNED_XDR);
      const call = buildInvokeTransactionMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('cancel_delivery');
      expect(call.sourceAddress).toBe(SENDER);
      expect(call.args).toEqual([
        addressToScVal(SENDER),
        deliveryIdToScVal(CHAIN_DELIVERY_ID),
      ]);
    });

    it('propagates a rejection from the shared builder', async () => {
      const error = new Error('builder failed');
      buildInvokeTransactionMock.mockRejectedValueOnce(error);

      await expect(
        createSorobanDeliveryContractClient(client, CONTRACT_ID).buildCancelDelivery({
          senderAddress: SENDER,
          chainDeliveryId: CHAIN_DELIVERY_ID,
        }),
      ).rejects.toBe(error);
    });
  });

  describe('buildRaiseDispute', () => {
    it('passes the expected contract method, source address and arguments', async () => {
      const result = await createSorobanDeliveryContractClient(
        client,
        CONTRACT_ID,
      ).buildRaiseDispute({
        callerAddress: CALLER,
        chainDeliveryId: CHAIN_DELIVERY_ID,
      });

      expect(result).toBe(UNSIGNED_XDR);
      const call = buildInvokeTransactionMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('raise_dispute');
      expect(call.sourceAddress).toBe(CALLER);
      expect(call.args).toEqual([
        addressToScVal(CALLER),
        deliveryIdToScVal(CHAIN_DELIVERY_ID),
      ]);
    });

    it('propagates a rejection from the shared builder', async () => {
      const error = new Error('builder failed');
      buildInvokeTransactionMock.mockRejectedValueOnce(error);

      await expect(
        createSorobanDeliveryContractClient(client, CONTRACT_ID).buildRaiseDispute({
          callerAddress: CALLER,
          chainDeliveryId: CHAIN_DELIVERY_ID,
        }),
      ).rejects.toBe(error);
    });
  });

  describe('getDelivery', () => {
    it('passes the expected contract method and delivery id argument', async () => {
      const simulateReadCallMock = vi.mocked(simulateReadCall);
      simulateReadCallMock.mockResolvedValueOnce(
        nativeToScVal({}, { type: 'map' }) as unknown as never,
      );

      await createSorobanDeliveryContractClient(client, CONTRACT_ID).getDelivery(
        CHAIN_DELIVERY_ID,
      );

      const call = simulateReadCallMock.mock.calls[0][1];
      expect(call.contractId).toBe(CONTRACT_ID);
      expect(call.method).toBe('get_delivery');
      expect(call.args).toEqual([deliveryIdToScVal(CHAIN_DELIVERY_ID)]);
    });
  });
});
