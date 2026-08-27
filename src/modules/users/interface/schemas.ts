import { z } from 'zod';

/** Stellar (Soroban) public key: 'G' + 55 base32 characters. */
const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/, 'Not a valid Stellar public key');

const walletDto = z.object({
  id: z.string().uuid(),
  address: z.string(),
  isPrimary: z.boolean(),
  verifiedAt: z.string().datetime().nullable(),
});

export const profileResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    email: z.string(),
    role: z.string(),
    emailVerifiedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    wallets: z.array(walletDto),
  }),
});

export const requestChallengeBodySchema = z.object({
  address: stellarAddress,
});
export const requestChallengeResponseSchema = z.object({
  data: z.object({ challenge: z.string() }),
});

export const confirmWalletBodySchema = z.object({
  address: stellarAddress,
  challenge: z.string().min(1),
  signature: z.string().min(1),
});
export const walletResponseSchema = z.object({ data: walletDto });

export const listWalletsResponseSchema = z.object({ data: z.array(walletDto) });

export const walletIdParamsSchema = z.object({ id: z.string().uuid() });

export const emptyDataResponseSchema = z.object({ data: z.object({}) });
