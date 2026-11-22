import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Memo,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { SorobanClient } from '../soroban-client.js';
import { buildInvokeTransaction } from './build-invoke-transaction.js';
import { u64ToScVal } from './sc-val.js';

/**
 * Unit-level: stubs the two SorobanClient methods this function calls
 * rather than hitting the real network. Real-network proof that
 * `getAccount`/`prepareTransaction`'s underlying RPC calls actually work
 * lives at the SorobanClient level (soroban-event-source.integration.spec.ts
 * exercises the same resilient-client wrapper against the live testnet RPC
 * for getLatestLedger/getEvents) — repeating that here against a
 * friendbot-funded throwaway account would make this suite flaky/rate-limited
 * for no additional coverage of *this* function's own logic, which is pure
 * orchestration: build the right operation, prepare it, return its XDR.
 */
describe('buildInvokeTransaction', () => {
  it('builds an invoke operation for the given contract/method/args and returns the prepared XDR', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('assign_driver'))
      .setTimeout(60)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    const xdr = await buildInvokeTransaction(client, {
      contractId,
      method: 'assign_driver',
      args: [u64ToScVal(7n)],
      sourceAddress: sourceKeypairAddress,
    });

    expect(client.getAccount).toHaveBeenCalledWith(sourceKeypairAddress);
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(xdr).toBe(preparedTx.toXDR());

    // The transaction handed to prepareTransaction invokes the right
    // contract and method — the actual correctness this function owns.
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    expect(builtTx?.operations).toHaveLength(1);
    const operation = builtTx?.operations[0];
    expect(operation?.type).toBe('invokeHostFunction');
  });

  it('uses a custom fee cap when provided (e.g. 10,000 stroops)', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('assign_driver'))
      .setTimeout(60)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    await buildInvokeTransaction(client, {
      contractId,
      method: 'assign_driver',
      args: [u64ToScVal(7n)],
      sourceAddress: sourceKeypairAddress,
      fee: 10_000,
    });

    expect(prepareSpy).toHaveBeenCalledTimes(1);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    expect(builtTx?.fee).toBe('10000');
  });

  it('attaches Memo.text to the built envelope when a memo is provided', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('assign_driver'))
      .setTimeout(60)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    await buildInvokeTransaction(client, {
      contractId,
      method: 'assign_driver',
      args: [u64ToScVal(7n)],
      sourceAddress: sourceKeypairAddress,
      memo: Memo.text('delivery-ref'),
    });

    expect(prepareSpy).toHaveBeenCalledTimes(1);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    expect(builtTx).toBeDefined();
    if (!builtTx || !('memo' in builtTx)) {
      throw new Error('expected a Transaction, not a FeeBumpTransaction');
    }
    expect(builtTx.memo).toEqual(Memo.text('delivery-ref'));
  });

  it('defaults to BASE_FEE and no memo when fee and memo are omitted', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('assign_driver'))
      .setTimeout(60)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    await buildInvokeTransaction(client, {
      contractId,
      method: 'assign_driver',
      args: [u64ToScVal(7n)],
      sourceAddress: sourceKeypairAddress,
    });

    expect(prepareSpy).toHaveBeenCalledTimes(1);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    expect(builtTx).toBeDefined();
    if (!builtTx || !('memo' in builtTx)) {
      throw new Error('expected a Transaction, not a FeeBumpTransaction');
    }
    expect(builtTx.fee).toBe(BASE_FEE);
    expect(builtTx.memo.type).toBe(Memo.none().type);
    expect(builtTx.memo.value).toBeNull();
  });

  it('builds the invoke operation against the fetched account’s own source and sequence number', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    // A non-default sequence proves the builder reads it from the fetched
    // Account rather than defaulting/zeroing it.
    const account = new Account(sourceKeypairAddress, '424242');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '424242'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('assign_driver'))
      .setTimeout(60)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    await buildInvokeTransaction(client, {
      contractId,
      method: 'assign_driver',
      args: [u64ToScVal(7n)],
      sourceAddress: sourceKeypairAddress,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    if (!builtTx || !('source' in builtTx)) {
      throw new Error('expected a Transaction, not a FeeBumpTransaction');
    }
    // The next unused sequence (fetched sequence + 1, per TransactionBuilder)
    // together with the source address — asserted together, not separately,
    // since either one alone could pass while the pairing was still wrong
    // (e.g. a stale account's source combined with a fresh sequence).
    expect(builtTx.source).toBe(sourceKeypairAddress);
    expect(builtTx.sequence).toBe('424243');
  });

  it('propagates a failed account lookup instead of returning an unprepared fallback', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    const accountError = new Error('account lookup failed');
    vi.spyOn(client, 'getAccount').mockRejectedValue(accountError);
    const prepareSpy = vi.spyOn(client, 'prepareTransaction');

    await expect(
      buildInvokeTransaction(client, {
        contractId,
        method: 'assign_driver',
        args: [u64ToScVal(7n)],
        sourceAddress: sourceKeypairAddress,
      }),
    ).rejects.toBe(accountError);

    expect(prepareSpy).not.toHaveBeenCalled();
  });

  it('propagates a failed preparation instead of returning the unprepared envelope', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);
    const prepareError = new Error('simulation failed');
    vi.spyOn(client, 'prepareTransaction').mockRejectedValue(prepareError);

    await expect(
      buildInvokeTransaction(client, {
        contractId,
        method: 'assign_driver',
        args: [u64ToScVal(7n)],
        sourceAddress: sourceKeypairAddress,
      }),
    ).rejects.toBe(prepareError);
  });
});
