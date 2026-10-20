import { StrKey } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createEscrowBodySchema } from './schemas.js';

describe('createEscrowBodySchema Soroban contract token address (#421)', () => {
  it('accepts valid C... Soroban contract addresses and G... account addresses for token', () => {
    const contractAddr = StrKey.encodeContract(Buffer.alloc(32, 7));
    const accountAddr = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
    const parsedContract = createEscrowBodySchema.safeParse({
      senderAddress: accountAddr,
      recipientAddress: accountAddr,
      driverAddress: accountAddr,
      chainDeliveryId: '42',
      token: contractAddr,
      amount: '1000',
    });
    const parsedAccount = createEscrowBodySchema.safeParse({
      senderAddress: accountAddr,
      recipientAddress: accountAddr,
      driverAddress: accountAddr,
      chainDeliveryId: '42',
      token: accountAddr,
      amount: '1000',
    });
    expect(parsedContract.success).toBe(true);
    expect(parsedAccount.success).toBe(true);
  });
});
