import {
  Account,
  Address,
  Contract,
  Keypair,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type { FeeBumpTransaction, rpc } from '@stellar/stellar-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SorobanClient } from '../src/blockchain/soroban-client.js';
import { addressToScVal, scValToNative } from '../src/blockchain/xdr/sc-val.js';
import * as config from '../src/shared/config/index.js';
import { parseEnv } from '../src/shared/config/env.js';
import { AppError } from '../src/shared/errors/app-error.js';
import type {
  FleetContractReader,
  FleetTransactionBuilder,
} from '../src/modules/fleet/domain/ports.js';
import { DriverPayoutAddressNotFoundError } from '../src/modules/fleet/domain/errors.js';
import { createSorobanFleetContractClient } from '../src/modules/fleet/infrastructure/soroban-fleet-contract-client.js';
import { createGetPayoutAddressUseCase } from '../src/modules/fleet/application/get-payout-address.js';

const CONTRACT_ID = Address.contract(Buffer.alloc(32, 7)).toString();
const NETWORK = 'M14 isolated custom network passphrase';
const OWNER = Keypair.random().publicKey();
const DRIVER = Keypair.random().publicKey();
const TREASURY = Keypair.random().publicKey();

function setup() {
  const client = new SorobanClient('http://127.0.0.1:9');
  const getAccount = vi
    .spyOn(client, 'getAccount')
    .mockImplementation(async (source) => new Account(source, '100'));
  const prepared = new TransactionBuilder(new Account(OWNER, '200'), {
    fee: '987',
    networkPassphrase: NETWORK,
  })
    .addOperation(new Contract(CONTRACT_ID).call('prepared_fixture'))
    .setTimeout(60)
    .build();
  const prepare = vi.spyOn(client, 'prepareTransaction').mockResolvedValue(prepared);
  // Compile-time contract check: the adapter must implement both production ports.
  const adapter: FleetContractReader & FleetTransactionBuilder = createSorobanFleetContractClient(
    client,
    CONTRACT_ID,
  );
  return { client, getAccount, prepared, prepare, adapter };
}

function invocation(tx: Transaction | FeeBumpTransaction, fee = '100') {
  if (!(tx instanceof Transaction)) throw new Error('Expected ordinary transaction');
  expect(tx.signatures).toEqual([]);
  expect(tx.networkPassphrase).toBe(NETWORK);
  expect(tx.fee).toBe(fee);
  expect(tx.operations).toHaveLength(1);
  const op = tx.operations[0];
  if (op?.type !== 'invokeHostFunction') throw new Error('Expected contract invocation');
  const call = op.func.invokeContract();
  expect(Address.fromScAddress(call.contractAddress()).toString()).toBe(CONTRACT_ID);
  return { tx, method: call.functionName().toString(), args: call.args() };
}

function simulation(retval?: xdr.ScVal): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: 'fixture',
    latestLedger: 1000,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '100',
    cost: { cpuInsns: '1', memBytes: '1' },
    ...(retval ? { result: { auth: [], retval } } : {}),
  };
}

describe('fleet unsigned-XDR compatibility', () => {
  beforeEach(() => {
    vi.spyOn(config, 'getConfig').mockReturnValue(
      parseEnv({
        ...process.env,
        STELLAR_NETWORK_PASSPHRASE: NETWORK,
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const cases = [
    {
      method: 'register_fleet',
      source: OWNER,
      args: [OWNER, TREASURY],
      call: (a: FleetTransactionBuilder) =>
        a.buildRegisterFleet({ ownerAddress: OWNER, treasuryAddress: TREASURY }),
    },
    {
      method: 'update_fleet_treasury',
      source: OWNER,
      args: [OWNER, '7', TREASURY],
      call: (a: FleetTransactionBuilder) =>
        a.buildUpdateFleetTreasury({
          ownerAddress: OWNER,
          chainFleetId: 7n,
          treasuryAddress: TREASURY,
        }),
    },
    {
      method: 'add_driver_to_fleet',
      source: OWNER,
      args: [OWNER, '7', DRIVER],
      call: (a: FleetTransactionBuilder) =>
        a.buildAddDriverToFleet({ callerAddress: OWNER, chainFleetId: 7n, driverAddress: DRIVER }),
    },
    {
      method: 'accept_fleet_invite',
      source: DRIVER,
      args: ['7', DRIVER],
      call: (a: FleetTransactionBuilder) =>
        a.buildAcceptFleetInvite({ chainFleetId: 7n, driverAddress: DRIVER }),
    },
    {
      method: 'remove_driver_from_fleet',
      source: OWNER,
      args: ['7', OWNER, DRIVER],
      call: (a: FleetTransactionBuilder) =>
        a.buildRemoveDriverFromFleet({
          callerAddress: OWNER,
          chainFleetId: 7n,
          driverAddress: DRIVER,
        }),
    },
  ];

  it.each(cases)(
    '$method uses configured network, exact invocation and prepared unsigned XDR',
    async ({ method, source, args, call }) => {
      const { adapter, prepared, prepare, getAccount } = setup();
      const before = Math.floor(Date.now() / 1000);
      const envelope = await call(adapter);
      expect(getAccount).toHaveBeenCalledExactlyOnceWith(source);
      expect(prepare).toHaveBeenCalledTimes(1);
      const built = invocation(prepare.mock.calls[0]![0]);
      expect(built.method).toBe(method);
      expect(built.tx.source).toBe(source);
      expect(built.tx.sequence).toBe('101');
      expect(built.tx.timeBounds?.minTime).toBe('0');
      expect(Number(built.tx.timeBounds?.maxTime)).toBeGreaterThanOrEqual(before + 60);
      expect(Number(built.tx.timeBounds?.maxTime)).toBeLessThanOrEqual(
        Math.floor(Date.now() / 1000) + 60,
      );
      expect(built.args.map(scValToNative)).toEqual(args);
      // Fleet IDs remain bare u64, never a tuple/vector or lossy JS number.
      if (method !== 'register_fleet') {
        const index =
          method === 'accept_fleet_invite' || method === 'remove_driver_from_fleet' ? 0 : 1;
        expect(built.args[index]!.switch().name).toBe('scvU64');
      }
      expect(envelope).toBe(prepared.toXDR());
      const decoded = TransactionBuilder.fromXDR(envelope, NETWORK);
      expect(decoded.signatures).toEqual([]);
      expect(decoded.fee).toBe('987');
      expect(invocation(new Transaction(envelope, NETWORK), '987').method).toBe('prepared_fixture');
    },
  );

  it('preserves account-fetch failure without attempting preparation', async () => {
    const { adapter, getAccount, prepare } = setup();
    const failure = new Error('account fixture failure');
    getAccount.mockRejectedValue(failure);
    await expect(
      adapter.buildRegisterFleet({ ownerAddress: OWNER, treasuryAddress: TREASURY }),
    ).rejects.toBe(failure);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('propagates transaction preparation failure unchanged', async () => {
    const { adapter, prepare } = setup();
    const failure = new Error('prepare fixture failure');
    prepare.mockRejectedValue(failure);
    await expect(
      adapter.buildRegisterFleet({ ownerAddress: OWNER, treasuryAddress: TREASURY }),
    ).rejects.toBe(failure);
  });

  it('simulates payout with (driver, bare u64 fleet ID) and returns fresh results', async () => {
    const { client, adapter, prepare, getAccount } = setup();
    const simulate = vi
      .spyOn(client, 'simulateTransaction')
      .mockResolvedValueOnce(simulation(addressToScVal(TREASURY)))
      .mockResolvedValueOnce(simulation(addressToScVal(DRIVER)));
    const getPayout = createGetPayoutAddressUseCase({ contractReader: adapter });
    const fleetId = (1n << 63n) + 7n;
    expect(await getPayout({ driverAddress: DRIVER, chainFleetId: fleetId })).toBe(TREASURY);
    expect(await getPayout({ driverAddress: DRIVER, chainFleetId: fleetId })).toBe(DRIVER);
    expect(getAccount).toHaveBeenCalledWith(DRIVER);
    expect(simulate).toHaveBeenCalledTimes(2);
    for (const [tx] of simulate.mock.calls) {
      const built = invocation(tx);
      expect(built.method).toBe('get_payout_address');
      expect(built.args.map(scValToNative)).toEqual([DRIVER, fleetId.toString()]);
      expect(built.args[1]!.switch().name).toBe('scvU64');
    }
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([undefined, xdr.ScVal.scvVoid()])(
    'preserves typed missing-payout errors for %s',
    async (retval) => {
      const { client, adapter } = setup();
      vi.spyOn(client, 'simulateTransaction').mockResolvedValue(simulation(retval));
      const result = adapter.getPayoutAddress(DRIVER, 7n);
      await expect(result).rejects.toBeInstanceOf(DriverPayoutAddressNotFoundError);
      await expect(result).rejects.toBeInstanceOf(AppError);
      await expect(result).rejects.toMatchObject({
        statusCode: 404,
        code: 'DRIVER_NOT_FOUND',
        message: 'Driver payout address not found',
      });
    },
  );

  it('rejects a non-address-shaped result instead of returning it', async () => {
    const { client, adapter } = setup();
    vi.spyOn(client, 'simulateTransaction').mockResolvedValue(simulation(xdr.ScVal.scvU32(42)));
    await expect(adapter.getPayoutAddress(DRIVER, 7n)).rejects.toThrow(
      'Expected get_payout_address to return an Address-as-string',
    );
  });

  it('reports simulation error rather than a missing payout', async () => {
    const { client, adapter } = setup();
    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: 'fixture',
      latestLedger: 1,
      events: [],
      _parsed: true,
      error: 'fixture contract failure',
    });
    await expect(adapter.getPayoutAddress(DRIVER, 7n)).rejects.toThrow(
      'get_payout_address simulation failed: fixture contract failure',
    );
  });

  it('propagates RPC simulation rejection unchanged', async () => {
    const { client, adapter } = setup();
    const failure = new Error('RPC fixture failure');
    vi.spyOn(client, 'simulateTransaction').mockRejectedValue(failure);
    await expect(adapter.getPayoutAddress(DRIVER, 7n)).rejects.toBe(failure);
  });
});
