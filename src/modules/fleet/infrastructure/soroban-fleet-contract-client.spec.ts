import { randomBytes } from 'node:crypto';
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { rpc, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { SorobanClient } from '../../../blockchain/soroban-client.js';
import { addressToScVal, scValToNative } from '../../../blockchain/xdr/sc-val.js';
import { createSorobanFleetContractClient } from './soroban-fleet-contract-client.js';

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

function invokedArgs(prepareSpy: ReturnType<typeof stubPreparedTransaction>) {
  const builtTx = prepareSpy.mock.calls[0]?.[0];
  const op = builtTx?.operations[0] as { func: xdr.HostFunction };
  const invokeArgs = op.func.invokeContract();
  return { method: invokeArgs.functionName().toString(), args: invokeArgs.args() };
}

describe('createSorobanFleetContractClient — write calls', () => {
  it('buildRegisterFleet invokes register_fleet with (owner, treasury) and the owner as source', async () => {
    const client = new SorobanClient();
    const owner = Keypair.random().publicKey();
    const treasury = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, owner);

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);
    await contractClient.buildRegisterFleet({ ownerAddress: owner, treasuryAddress: treasury });

    expect(client.getAccount).toHaveBeenCalledWith(owner);
    const { method, args } = invokedArgs(prepareSpy);
    expect(method).toBe('register_fleet');
    expect(scValToNative(args[0]!)).toBe(owner);
    expect(scValToNative(args[1]!)).toBe(treasury);
  });

  it('buildUpdateFleetTreasury invokes update_fleet_treasury with a bare u64 fleet id and the owner as source', async () => {
    const client = new SorobanClient();
    const owner = Keypair.random().publicKey();
    const treasury = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, owner);

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);
    await contractClient.buildUpdateFleetTreasury({
      ownerAddress: owner,
      chainFleetId: 7n,
      treasuryAddress: treasury,
    });

    expect(client.getAccount).toHaveBeenCalledWith(owner);
    const { method, args } = invokedArgs(prepareSpy);
    expect(method).toBe('update_fleet_treasury');
    expect(scValToNative(args[0]!)).toBe(owner);
    expect(scValToNative(args[1]!)).toBe('7');
    expect(scValToNative(args[2]!)).toBe(treasury);
  });

  it('buildAddDriverToFleet invokes add_driver_to_fleet with the caller as source', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, caller);

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);
    await contractClient.buildAddDriverToFleet({
      callerAddress: caller,
      chainFleetId: 3n,
      driverAddress: driver,
    });

    expect(client.getAccount).toHaveBeenCalledWith(caller);
    const { method, args } = invokedArgs(prepareSpy);
    expect(method).toBe('add_driver_to_fleet');
    expect(scValToNative(args[0]!)).toBe(caller);
    expect(scValToNative(args[1]!)).toBe('3');
    expect(scValToNative(args[2]!)).toBe(driver);
  });

  it('buildAcceptFleetInvite invokes accept_fleet_invite with the driver as source (driver signs, not the owner)', async () => {
    const client = new SorobanClient();
    const driver = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, driver);

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);
    await contractClient.buildAcceptFleetInvite({ chainFleetId: 9n, driverAddress: driver });

    expect(client.getAccount).toHaveBeenCalledWith(driver);
    const { method, args } = invokedArgs(prepareSpy);
    expect(method).toBe('accept_fleet_invite');
    expect(scValToNative(args[0]!)).toBe('9');
    expect(scValToNative(args[1]!)).toBe(driver);
  });

  it('buildRemoveDriverFromFleet invokes remove_driver_from_fleet with the caller as source', async () => {
    const client = new SorobanClient();
    const caller = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, caller);

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);
    await contractClient.buildRemoveDriverFromFleet({
      callerAddress: caller,
      chainFleetId: 4n,
      driverAddress: driver,
    });

    expect(client.getAccount).toHaveBeenCalledWith(caller);
    const { method, args } = invokedArgs(prepareSpy);
    expect(method).toBe('remove_driver_from_fleet');
    expect(scValToNative(args[0]!)).toBe('4');
    expect(scValToNative(args[1]!)).toBe(caller);
    expect(scValToNative(args[2]!)).toBe(driver);
  });
});

describe('createSorobanFleetContractClient — getPayoutAddress', () => {
  it('calls get_payout_address via simulation and decodes the returned Address', async () => {
    const client = new SorobanClient();
    const driver = Keypair.random().publicKey();
    const treasury = Keypair.random().publicKey();

    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1000,
      events: [],
      transactionData: {} as never,
      minResourceFee: '100',
      cost: {} as never,
      result: { auth: [], retval: addressToScVal(treasury) },
      _parsed: true,
    } satisfies rpc.Api.SimulateTransactionSuccessResponse);

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);
    const payoutAddress = await contractClient.getPayoutAddress(driver, 2n);

    expect(payoutAddress).toBe(treasury);
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

    const contractClient = createSorobanFleetContractClient(client, CONTRACT_ID);

    await expect(contractClient.getPayoutAddress('GDRIVER', 999n)).rejects.toThrow();
  });
});
