import { Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { addressToScVal, scValToNative, u64ToScVal } from '../../../blockchain/xdr/sc-val.js';
import { createEscrowArgsToScVal, nativeToChainEscrowRecord } from './escrow-scval-mapping.js';

describe('createEscrowArgsToScVal', () => {
  it('produces [sender, recipient, driver, delivery_id, token, amount] with delivery_id as a bare u64', () => {
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const token = Keypair.random().publicKey();

    const args = createEscrowArgsToScVal({
      senderAddress: sender,
      recipientAddress: recipient,
      driverAddress: driver,
      chainDeliveryId: 42n,
      token,
      amount: 1_000_000n,
    });

    expect(args).toHaveLength(6);
    expect(scValToNative(args[0]!)).toBe(sender);
    expect(scValToNative(args[1]!)).toBe(recipient);
    expect(scValToNative(args[2]!)).toBe(driver);
    // Bare u64 — NOT the one-element Vec that delivery_contract's tuple-struct
    // DeliveryId encoding produces. escrow_contract takes delivery_id raw.
    expect(scValToNative(args[3]!)).toBe('42');
    expect(scValToNative(args[4]!)).toBe(token);
    expect(scValToNative(args[5]!)).toBe('1000000');
  });
});

/** Hand-builds a `get_escrow`-shaped ScVal using the same low-level encoders
 * escrow-scval-mapping.ts decodes against — mirrors
 * delivery-scval-mapping.spec.ts's verification approach. */
function buildEscrowRecordScVal(input: {
  sender: string;
  recipient: string;
  driver: string;
  token: string;
  amount: bigint;
  status: string;
  createdAt: bigint;
  disputedBy: string | null;
  disputedAt: bigint | null;
}): xdr.ScVal {
  return xdr.ScVal.scvMap(
    [
      [
        'amount',
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({ hi: new xdr.Int64(0n), lo: new xdr.Uint64(input.amount) }),
        ),
      ],
      ['created_at', u64ToScVal(input.createdAt)],
      [
        'disputed_at',
        input.disputedAt !== null ? u64ToScVal(input.disputedAt) : xdr.ScVal.scvVoid(),
      ],
      ['disputed_by', input.disputedBy ? addressToScVal(input.disputedBy) : xdr.ScVal.scvVoid()],
      ['driver', addressToScVal(input.driver)],
      ['recipient', addressToScVal(input.recipient)],
      ['sender', addressToScVal(input.sender)],
      ['status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(input.status)])],
      ['token', addressToScVal(input.token)],
    ].map(
      ([k, v]) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k as string), val: v as xdr.ScVal }),
    ),
  );
}

describe('nativeToChainEscrowRecord', () => {
  it('decodes a Locked record with no dispute fields', () => {
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const driver = Keypair.random().publicKey();
    const token = Keypair.random().publicKey();

    const scVal = buildEscrowRecordScVal({
      sender,
      recipient,
      driver,
      token,
      amount: 1_000_000n,
      status: 'Locked',
      createdAt: 1_700_000_000n,
      disputedBy: null,
      disputedAt: null,
    });

    const record = nativeToChainEscrowRecord(scValToNative(scVal), 7n);

    expect(record).toEqual({
      chainDeliveryId: 7n,
      senderAddress: sender,
      recipientAddress: recipient,
      driverAddress: driver,
      token,
      amount: 1_000_000n,
      status: 'LOCKED',
      disputedBy: null,
      disputedAt: null,
      createdAtChain: new Date(1_700_000_000 * 1000),
    });
  });

  it('decodes a Paused record with dispute fields present', () => {
    const disputer = Keypair.random().publicKey();
    const scVal = buildEscrowRecordScVal({
      sender: Keypair.random().publicKey(),
      recipient: Keypair.random().publicKey(),
      driver: Keypair.random().publicKey(),
      token: Keypair.random().publicKey(),
      amount: 500_000n,
      status: 'Paused',
      createdAt: 1_700_000_000n,
      disputedBy: disputer,
      disputedAt: 1_700_050_000n,
    });

    const record = nativeToChainEscrowRecord(scValToNative(scVal), 1n);

    expect(record.status).toBe('PAUSED');
    expect(record.disputedBy).toBe(disputer);
    expect(record.disputedAt).toEqual(new Date(1_700_050_000 * 1000));
  });

  it('throws on a structurally invalid record rather than returning partial data', () => {
    expect(() => nativeToChainEscrowRecord({ not: 'an escrow record' }, 1n)).toThrow();
  });
});
