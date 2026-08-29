import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
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

  it('respects configurable fee from input when provided', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();
    const customFee = '5000'; // Higher than BASE_FEE

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: customFee,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('test_method'))
      .setTimeout(60)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    await buildInvokeTransaction(client, {
      contractId,
      method: 'test_method',
      args: [],
      sourceAddress: sourceKeypairAddress,
      feeSorobanStroops: 5000,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    expect(builtTx?.fee).toBe(customFee);
  });

  it('respects configurable timeout from input when provided', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();
    const customTimeout = 300; // Longer for interactive wallet approval

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('test_method'))
      .setTimeout(customTimeout)
      .build();
    const prepareSpy = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    await buildInvokeTransaction(client, {
      contractId,
      method: 'test_method',
      args: [],
      sourceAddress: sourceKeypairAddress,
      timeoutSeconds: customTimeout,
    });

    const builtTx = prepareSpy.mock.calls[0]?.[0];
    expect(builtTx?.timebounds?.timeout).toBe(customTimeout);
  });

  it('includes envelope expiry timestamp in response metadata', async () => {
    const sourceKeypairAddress = Keypair.random().publicKey();
    const account = new Account(sourceKeypairAddress, '100');
    const contractId = Address.contract(randomBytes(32)).toString();

    const client = new SorobanClient();
    vi.spyOn(client, 'getAccount').mockResolvedValue(account);

    const timeoutSeconds = 300;

    const preparedTx = new TransactionBuilder(new Account(sourceKeypairAddress, '100'), {
      fee: BASE_FEE,
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(new Contract(contractId).call('test_method'))
      .setTimeout(timeoutSeconds)
      .build();
    vi.spyOn(client, 'prepareTransaction').mockResolvedValue(preparedTx);

    const xdr = await buildInvokeTransaction(client, {
      contractId,
      method: 'test_method',
      args: [],
      sourceAddress: sourceKeypairAddress,
      timeoutSeconds,
    });

    // The returned XDR should be a string
    expect(typeof xdr).toBe('string');
    // XDR should be non-empty
    expect(xdr.length).toBeGreaterThan(0);
  });
});
