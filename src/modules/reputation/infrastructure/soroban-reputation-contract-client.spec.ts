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
import { createSorobanReputationContractClient } from './soroban-reputation-contract-client.js';

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

describe('createSorobanReputationContractClient — write calls', () => {
  it('buildRegisterDriver invokes register_driver with the driver as source', async () => {
    const client = new SorobanClient();
    const driver = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, driver);

    const contractClient = createSorobanReputationContractClient(client, CONTRACT_ID);
    await contractClient.buildRegisterDriver({ driverAddress: driver });

    expect(client.getAccount).toHaveBeenCalledWith(driver);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('register_driver');
    expect(scValToNative(invokeArgs.args()[0]!)).toBe(driver);
  });

  it('buildUpdateDriverKycStatus invokes update_driver_kyc_status with the admin as source', async () => {
    const client = new SorobanClient();
    const admin = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const prepareSpy = stubPreparedTransaction(client, admin);

    const contractClient = createSorobanReputationContractClient(client, CONTRACT_ID);
    await contractClient.buildUpdateDriverKycStatus({
      adminAddress: admin,
      driverAddress: driver,
      kycVerified: true,
    });

    expect(client.getAccount).toHaveBeenCalledWith(admin);
    const builtTx = prepareSpy.mock.calls[0]?.[0];
    const op = builtTx?.operations[0] as { func: xdr.HostFunction };
    const invokeArgs = op.func.invokeContract();
    expect(invokeArgs.functionName().toString()).toBe('update_driver_kyc_status');
    const args = invokeArgs.args();
    expect(scValToNative(args[0]!)).toBe(admin);
    expect(scValToNative(args[1]!)).toBe(driver);
    expect(scValToNative(args[2]!)).toBe(true);
  });
});

describe('createSorobanReputationContractClient — getDriverProfile', () => {
  it('calls get_driver_profile via simulation and decodes the result', async () => {
    const client = new SorobanClient();
    const driver = Keypair.random().publicKey();

    const retval = xdr.ScVal.scvMap(
      [
        ['address', addressToScVal(driver)],
        ['deliveries_completed', xdr.ScVal.scvU32(5)],
        ['kyc_verified', xdr.ScVal.scvBool(false)],
        ['registered_at', u64ToScVal(1_700_000_000n)],
        ['reputation_score', xdr.ScVal.scvU32(55)],
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

    const contractClient = createSorobanReputationContractClient(client, CONTRACT_ID);
    const profile = await contractClient.getDriverProfile(driver);

    expect(profile.address).toBe(driver);
    expect(profile.reputationScore).toBe(55);
    expect(profile.deliveriesCompleted).toBe(5);
    expect(profile.kycVerified).toBe(false);
  });

  it('throws when simulation fails', async () => {
    const client = new SorobanClient();
    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1000,
      events: [],
      error: 'ProviderNotFound',
      _parsed: true,
    } satisfies rpc.Api.SimulateTransactionErrorResponse);

    const contractClient = createSorobanReputationContractClient(client, CONTRACT_ID);

    await expect(contractClient.getDriverProfile('GUNKNOWN')).rejects.toThrow();
  });
});
