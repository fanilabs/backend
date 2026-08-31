import { Keypair, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import {
  addressToScVal,
  bytesToScVal,
  scValToNative,
  u64ToScVal,
} from '../../../blockchain/xdr/sc-val.js';
import {
  addEvidenceHashArgsToScVal,
  nativeToChainDisputeCase,
  raiseDisputeArgsToScVal,
  resolveDisputeArgsToScVal,
  resolveDisputeSplitFundsArgsToScVal,
} from './disputes-scval-mapping.js';

describe('raiseDisputeArgsToScVal', () => {
  it('produces [caller, delivery_id] with delivery_id as a tuple-wrapped u64 (DeliveryId), not bare', () => {
    const caller = Keypair.random().publicKey();

    const args = raiseDisputeArgsToScVal({ callerAddress: caller, chainDeliveryId: 42n });

    expect(args).toHaveLength(2);
    expect(scValToNative(args[0]!)).toBe(caller);
    // A one-element array, unlike escrow_contract's bare '42'.
    expect(scValToNative(args[1]!)).toEqual(['42']);
  });
});

describe('addEvidenceHashArgsToScVal', () => {
  it('produces [caller, delivery_id, evidence_hash] with the hash as 32 raw bytes', () => {
    const caller = Keypair.random().publicKey();
    const hash = 'ab'.repeat(32);

    const args = addEvidenceHashArgsToScVal({
      callerAddress: caller,
      chainDeliveryId: 1n,
      evidenceHash: hash,
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[0]!)).toBe(caller);
    expect(scValToNative(args[1]!)).toEqual(['1']);
    expect(scValToNative(args[2]!)).toBe(Buffer.from(hash, 'hex').toString('base64'));
  });
});

describe('resolveDisputeArgsToScVal', () => {
  it('produces [caller, delivery_id] — shared by refund_sender and pay_driver', () => {
    const caller = Keypair.random().publicKey();

    const args = resolveDisputeArgsToScVal({ callerAddress: caller, chainDeliveryId: 9n });

    expect(args).toHaveLength(2);
    expect(scValToNative(args[1]!)).toEqual(['9']);
  });
});

describe('resolveDisputeSplitFundsArgsToScVal', () => {
  it('produces [caller, delivery_id, sender_share_bps]', () => {
    const caller = Keypair.random().publicKey();

    const args = resolveDisputeSplitFundsArgsToScVal({
      callerAddress: caller,
      chainDeliveryId: 3n,
      senderShareBps: 6000,
    });

    expect(args).toHaveLength(3);
    expect(scValToNative(args[2]!)).toBe(6000);
  });
});

/** Hand-builds a `DisputeCase`-shaped ScVal using the same low-level
 * encoders disputes-scval-mapping.ts decodes against — mirrors
 * escrow-scval-mapping.spec.ts's verification approach. */
function buildDisputeCaseScVal(input: {
  deliveryId: bigint;
  status: string;
  raisedAt: bigint;
  raisedBy: string;
  evidenceHashes: string[];
}): xdr.ScVal {
  return xdr.ScVal.scvMap(
    [
      ['delivery_id', xdr.ScVal.scvVec([u64ToScVal(input.deliveryId)])],
      ['evidence_hashes', xdr.ScVal.scvVec(input.evidenceHashes.map((hex) => bytesToScVal(hex)))],
      ['raised_at', u64ToScVal(input.raisedAt)],
      ['raised_by', addressToScVal(input.raisedBy)],
      ['status', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(input.status)])],
    ].map(
      ([k, v]) =>
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(k as string), val: v as xdr.ScVal }),
    ),
  );
}

describe('nativeToChainDisputeCase', () => {
  it('decodes an Open case with no evidence', () => {
    const raisedBy = Keypair.random().publicKey();
    const scVal = buildDisputeCaseScVal({
      deliveryId: 1n,
      status: 'Open',
      raisedAt: 1_700_000_000n,
      raisedBy,
      evidenceHashes: [],
    });

    const record = nativeToChainDisputeCase(scValToNative(scVal), 1n);

    expect(record).toEqual({
      chainDeliveryId: 1n,
      status: 'OPEN',
      raisedBy,
      raisedAt: new Date(1_700_000_000 * 1000),
      evidenceHashes: [],
    });
  });

  it('decodes evidence_hashes back to hex, matching what was encoded', () => {
    const hash1 = 'aa'.repeat(32);
    const hash2 = 'bb'.repeat(32);
    const scVal = buildDisputeCaseScVal({
      deliveryId: 5n,
      status: 'ResolvedRefund',
      raisedAt: 1_700_000_000n,
      raisedBy: Keypair.random().publicKey(),
      evidenceHashes: [hash1, hash2],
    });

    const record = nativeToChainDisputeCase(scValToNative(scVal), 5n);

    expect(record.status).toBe('RESOLVED_REFUND');
    expect(record.evidenceHashes).toEqual([hash1, hash2]);
  });

  it('decodes Split and ResolvedPayout statuses', () => {
    const base = {
      raisedAt: 1_700_000_000n,
      raisedBy: Keypair.random().publicKey(),
      evidenceHashes: [],
    };

    expect(
      nativeToChainDisputeCase(
        scValToNative(buildDisputeCaseScVal({ ...base, deliveryId: 1n, status: 'Split' })),
        1n,
      ).status,
    ).toBe('SPLIT');

    expect(
      nativeToChainDisputeCase(
        scValToNative(buildDisputeCaseScVal({ ...base, deliveryId: 1n, status: 'ResolvedPayout' })),
        1n,
      ).status,
    ).toBe('RESOLVED_PAYOUT');
  });

  it('throws on a structurally invalid case rather than returning partial data', () => {
    expect(() => nativeToChainDisputeCase({ not: 'a dispute case' }, 1n)).toThrow();
  });
});
