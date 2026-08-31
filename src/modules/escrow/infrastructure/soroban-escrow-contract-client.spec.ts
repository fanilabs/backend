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
import { createSorobanEscrowContractClient } from './soroban-escrow-contract-client.js';

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

describe('createSorobanEscrowContractClient — write calls', () => {
  it('buildCreateEscrow invokes create_escrow with delivery_id as a bare u64 and the sender as source', async () => {
    const client = new SorobanClient();
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const token = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, sender);

    const contractClient = createSorobanEscrowContractClient(client, CONTRACT_ID);
    await contractClient.buildCreateEscrow({
      senderAddress: sender,
      recipientAddress: recipient,
      driverAddress: driver,
      chainDeliveryId: 5n,
      token,
      amount: 1_000_000n,
    });

    expect(client.getAccount).toHaveBeenCalledWith(sender);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('create_escrow');
    const args = invokeArgs.args();
    expect(scValToNative(args[0]!)).toBe(sender);
    expect(scValToNative(args[1]!)).toBe(recipient);
    expect(scValToNative(args[2]!)).toBe(driver);
    expect(scValToNative(args[3]!)).toBe('5');
    expect(scValToNative(args[4]!)).toBe(token);
    expect(scValToNative(args[5]!)).toBe('1000000');
  });

  it('buildReleaseEscrow invokes release_escrow with (caller, delivery_id) and the caller as source', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, caller);

    const contractClient = createSorobanEscrowContractClient(client, CONTRACT_ID);
    await contractClient.buildReleaseEscrow({ callerAddress: caller, chainDeliveryId: 9n });

    expect(client.getAccount).toHaveBeenCalledWith(caller);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('release_escrow');
    const args = invokeArgs.args();
    expect(scValToNative(args[0]!)).toBe(caller);
    expect(scValToNative(args[1]!)).toBe('9');
  });

  it('buildRefundEscrow invokes refund_escrow with (caller, delivery_id) and the caller as source', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    stubPreparedTransaction(client, caller);

    const contractClient = createSorobanEscrowContractClient(client, CONTRACT_ID);
    await contractClient.buildRefundEscrow({ callerAddress: caller, chainDeliveryId: 3n });

    expect(client.getAccount).toHaveBeenCalledWith(caller);
  });
});

describe('createSorobanEscrowContractClient — getEscrow', () => {
  it('calls get_escrow via simulation with a bare u64 delivery_id and decodes the result', async () => {
    const client = new SorobanClient();
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const token = Keypair.random().publicKey();

    const retval = xdr.ScVal.scvMap(
      [
        [
          'amount',
          xdr.ScVal.scvI128(
            new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(1_000_000n) }),
          ),
        ],
        ['created_at', u64ToScVal(1_700_000_000n)],
        ['disputed_at', xdr.ScVal.scvVoid()],
        ['disputed_by', xdr.ScVal.scvVoid()],
        ['driver', addressToScVal(driver)],
        ['recipient', addressToScVal(recipient)],
        ['sender', addressToScVal(sender)],
        ['status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Locked')])],
        ['token', addressToScVal(token)],
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

    const contractClient = createSorobanEscrowContractClient(client, CONTRACT_ID);
    const record = await contractClient.getEscrow(3n);

    expect(record.chainDeliveryId).toBe(3n);
    expect(record.senderAddress).toBe(sender);
    expect(record.driverAddress).toBe(driver);
    expect(record.token).toBe(token);
    expect(record.status).toBe('LOCKED');
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

    const contractClient = createSorobanEscrowContractClient(client, CONTRACT_ID);

    await expect(contractClient.getEscrow(999n)).rejects.toThrow();
  });
});
