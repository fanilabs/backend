import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type { rpc } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { SorobanClient } from '../../../blockchain/soroban-client.js';
import { addressToScVal, scValToNative, u64ToScVal } from '../../../blockchain/xdr/sc-val.js';
import { createSorobanDeliveryContractClient } from './soroban-delivery-contract-client.js';

const CONTRACT_ID = Address.contract(randomBytes(32)).toString();

function stubPreparedTransaction(client: SorobanClient, sourceAddress: string) {
  vi.spyOn(client, 'getAccount').mockResolvedValue(new Account(sourceAddress, '100'));
  const dummyTx = new TransactionBuilder(new Account(sourceAddress, '100'), {
    fee: BASE_FEE,
    networkPassphrase: 'Test SDF Network ; September 2015',
  })
    .addOperation(new Contract(CONTRACT_ID).call('noop'))
    .setTimeout(60)
    .build();
  return vi.spyOn(client, 'prepareTransaction').mockResolvedValue(dummyTx);
}

describe('createSorobanDeliveryContractClient — write calls', () => {
  it('buildAssignDriver invokes assign_driver with (caller, delivery_id, driver) and the caller as source', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, caller);

    const contractClient = createSorobanDeliveryContractClient(client, CONTRACT_ID);
    await contractClient.buildAssignDriver({
      callerAddress: caller,
      chainDeliveryId: 5n,
      driverAddress: driver,
    });

    expect(client.getAccount).toHaveBeenCalledWith(caller);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('assign_driver');
    const args = invokeArgs.args();
    expect(scValToNative(args[0]!)).toBe(caller);
    expect(scValToNative(args[1]!)).toEqual(['5']);
    expect(scValToNative(args[2]!)).toBe(driver);
  });

  it('buildConfirmDelivery uses the recipient as both the auth party and source account', async () => {
    const client = new SorobanClient();
    const recipient = Keypair.random().publicKey();
    stubPreparedTransaction(client, recipient);

    const contractClient = createSorobanDeliveryContractClient(client, CONTRACT_ID);
    await contractClient.buildConfirmDelivery({ recipientAddress: recipient, chainDeliveryId: 9n });

    expect(client.getAccount).toHaveBeenCalledWith(recipient);
  });
});

describe('createSorobanDeliveryContractClient — getDelivery', () => {
  it('calls get_delivery via simulation with the encoded DeliveryId and decodes the result', async () => {
    const client = new SorobanClient();
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();

    const retval = xdr.ScVal.scvMap(
      [
        ['delivery_id', xdr.ScVal.scvVec([u64ToScVal(3n)])],
        ['sender', addressToScVal(sender)],
        ['recipient', addressToScVal(recipient)],
        ['driver', xdr.ScVal.scvVoid()],
        ['status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Pending')])],
        [
          'metadata',
          xdr.ScVal.scvMap(
            [
              [
                'cargo_description',
                xdr.ScVal.scvMap(
                  [
                    ['category', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('General')])],
                    ['fragile', xdr.ScVal.scvBool(false)],
                    ['weight_grams', xdr.ScVal.scvU32(100)],
                  ].map(
                    ([k, v]) =>
                      new xdr.ScMapEntry({
                        key: xdr.ScVal.scvSymbol(k as string),
                        val: v as xdr.ScVal,
                      }),
                  ),
                ),
              ],
              ['created_at', u64ToScVal(1_700_000_000n)],
              ['delivery_id', u64ToScVal(0n)],
              ['destination', xdr.ScVal.scvString('Accra')],
              ['estimated_delivery', u64ToScVal(1_700_100_000n)],
              ['origin', xdr.ScVal.scvString('Lagos')],
            ].map(
              ([k, v]) =>
                new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k as string), val: v as xdr.ScVal }),
            ),
          ),
        ],
        ['created_at', u64ToScVal(1_700_000_000n)],
        ['delivered_at', xdr.ScVal.scvVoid()],
        ['transit_started_at', xdr.ScVal.scvVoid()],
      ].map(
        ([k, v]) =>
          new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k as string), val: v as xdr.ScVal }),
      ),
    );

    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1000,
      events: [],
      transactionData: {} as never,
      minResourceFee: '100',
      cost: {} as never,
      result: { auth: [], retval },
      _parsed: true,
    } satisfies rpc.Api.SimulateTransactionSuccessResponse);

    const contractClient = createSorobanDeliveryContractClient(client, CONTRACT_ID);
    const record = await contractClient.getDelivery(3n);

    expect(record.chainDeliveryId).toBe(3n);
    expect(record.senderAddress).toBe(sender);
    expect(record.recipientAddress).toBe(recipient);
    expect(record.status).toBe('PENDING');
    expect(record.origin).toBe('Lagos');
  });

  it('throws when simulation fails', async () => {
    const client = new SorobanClient();
    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1000,
      events: [],
      error: 'contract not found',
      _parsed: true,
    } satisfies rpc.Api.SimulateTransactionErrorResponse);

    const contractClient = createSorobanDeliveryContractClient(client, CONTRACT_ID);

    await expect(contractClient.getDelivery(999n)).rejects.toThrow();
  });
});
