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
import {
  addressToScVal,
  bytesToScVal,
  scValToNative,
  u64ToScVal,
} from '../../../blockchain/xdr/sc-val.js';
import { createSorobanDisputeContractClient } from './soroban-dispute-contract-client.js';

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

describe('createSorobanDisputeContractClient — write calls', () => {
  it('buildRaiseDispute invokes raise_dispute with a tuple-wrapped delivery_id and the caller as source', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, caller);

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);
    await contractClient.buildRaiseDispute({ callerAddress: caller, chainDeliveryId: 5n });

    expect(client.getAccount).toHaveBeenCalledWith(caller);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('raise_dispute');
    const args = invokeArgs.args();
    expect(scValToNative(args[0]!)).toBe(caller);
    expect(scValToNative(args[1]!)).toEqual(['5']);
  });

  it('buildAddEvidenceHash invokes add_evidence_hash with (caller, delivery_id, hash)', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, caller);
    const hash = 'cc'.repeat(32);

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);
    await contractClient.buildAddEvidenceHash({
      callerAddress: caller,
      chainDeliveryId: 2n,
      evidenceHash: hash,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('add_evidence_hash');
    const args = invokeArgs.args();
    expect(scValToNative(args[2]!)).toBe(Buffer.from(hash, 'hex').toString('base64'));
  });

  it('buildResolveDisputeRefundSender invokes resolve_dispute_refund_sender', async () => {
    const client = new SorobanClient();
    const admin = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, admin);

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);
    await contractClient.buildResolveDisputeRefundSender({
      callerAddress: admin,
      chainDeliveryId: 7n,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    expect(op.func.invokeContract().functionName().toString()).toBe(
      'resolve_dispute_refund_sender',
    );
  });

  it('buildResolveDisputePayDriver invokes resolve_dispute_pay_driver', async () => {
    const client = new SorobanClient();
    const admin = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, admin);

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);
    await contractClient.buildResolveDisputePayDriver({
      callerAddress: admin,
      chainDeliveryId: 7n,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    expect(op.func.invokeContract().functionName().toString()).toBe('resolve_dispute_pay_driver');
  });

  it('buildResolveDisputeSplitFunds invokes resolve_dispute_split_funds with sender_share_bps', async () => {
    const client = new SorobanClient();
    const admin = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, admin);

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);
    await contractClient.buildResolveDisputeSplitFunds({
      callerAddress: admin,
      chainDeliveryId: 7n,
      senderShareBps: 4000,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const args = op.func.invokeContract().args();
    expect(scValToNative(args[2]!)).toBe(4000);
  });
});

describe('createSorobanDisputeContractClient — getDispute', () => {
  it('calls get_dispute via simulation with a tuple-wrapped delivery_id and decodes the result', async () => {
    const client = new SorobanClient();
    const raisedBy = Keypair.random().publicKey();

    const retval = xdr.ScVal.scvMap(
      [
        ['delivery_id', xdr.ScVal.scvVec([u64ToScVal(3n)])],
        ['evidence_hashes', xdr.ScVal.scvVec([bytesToScVal('dd'.repeat(32))])],
        ['raised_at', u64ToScVal(1_700_000_000n)],
        ['raised_by', addressToScVal(raisedBy)],
        ['status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Open')])],
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

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);
    const record = await contractClient.getDispute(3n);

    expect(record.chainDeliveryId).toBe(3n);
    expect(record.raisedBy).toBe(raisedBy);
    expect(record.status).toBe('OPEN');
    expect(record.evidenceHashes).toEqual(['dd'.repeat(32)]);
  });

  it('throws when simulation fails (e.g. no on-chain case for this delivery)', async () => {
    const client = new SorobanClient();
    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1000,
      events: [],
      error: 'DeliveryNotFound',
      _parsed: true,
    } satisfies rpc.Api.SimulateTransactionErrorResponse);

    const contractClient = createSorobanDisputeContractClient(client, CONTRACT_ID);

    await expect(contractClient.getDispute(999n)).rejects.toThrow();
  });
});
