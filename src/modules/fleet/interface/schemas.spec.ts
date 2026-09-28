import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { acceptFleetInviteBodySchema, fleetIdParamsSchema } from './schemas.js';

describe('fleet id schemas', () => {
  it('accepts a chain fleet id within the u64 decimal length limit', () => {
    const result = acceptFleetInviteBodySchema.safeParse({
      chainFleetId: '18446744073709551615',
      driverAddress: Keypair.random().publicKey(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects a chain fleet id longer than 20 digits in request bodies', () => {
    const result = acceptFleetInviteBodySchema.safeParse({
      chainFleetId: '1'.repeat(21),
      driverAddress: Keypair.random().publicKey(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a chain fleet id longer than 20 digits in route params', () => {
    const result = fleetIdParamsSchema.safeParse({ chainFleetId: '1'.repeat(21) });
    expect(result.success).toBe(false);
  });
});
