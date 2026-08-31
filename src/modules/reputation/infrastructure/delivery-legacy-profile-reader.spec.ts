import { randomBytes } from 'node:crypto';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import type { rpc } from '@stellar/stellar-sdk';
import { describe, expect, it, vi } from 'vitest';
import { SorobanClient } from '../../../blockchain/soroban-client.js';
import { addressToScVal, u64ToScVal } from '../../../blockchain/xdr/sc-val.js';
import { createDeliveryLegacyProfileReader } from './delivery-legacy-profile-reader.js';

const CONTRACT_ID = Address.contract(randomBytes(32)).toString();

describe('createDeliveryLegacyProfileReader', () => {
  it('reads delivery_contract.get_driver_profile and returns only deliveries_completed', async () => {
    const client = new SorobanClient();
    const driver = Keypair.random().publicKey();

    const retval = xdr.ScVal.scvMap(
      [
        ['address', addressToScVal(driver)],
        ['deliveries_completed', xdr.ScVal.scvU32(9)],
        ['kyc_verified', xdr.ScVal.scvBool(false)],
        ['registered_at', u64ToScVal(1_700_000_000n)],
        // delivery_contract's own, separate reputation_score — must never
        // be surfaced by this reader (PHASE_1_DOMAIN_ANALYSIS.md §12).
        ['reputation_score', xdr.ScVal.scvU32(3)],
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

    const reader = createDeliveryLegacyProfileReader(client, CONTRACT_ID);
    const count = await reader.getLegacyDeliveriesCompleted(driver);

    expect(count).toBe(9);
  });

  it('throws when simulation fails (e.g. driver has no legacy profile yet)', async () => {
    const client = new SorobanClient();
    vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
      id: '1',
      latestLedger: 1000,
      events: [],
      error: 'not found',
      _parsed: true,
    } satisfies rpc.Api.SimulateTransactionErrorResponse);

    const reader = createDeliveryLegacyProfileReader(client, CONTRACT_ID);

    await expect(
      reader.getLegacyDeliveriesCompleted(Keypair.random().publicKey()),
    ).rejects.toThrow();
  });
});
