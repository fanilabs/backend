import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';

const AUTH_USER_ID = 'synthetic-auth-user-id';

vi.mock('../../../shared/http/plugins/auth-guard.js', () => ({
  authenticate: async (request: { user?: { id: string; role: string } }) => {
    request.user = { id: 'synthetic-auth-user-id', role: 'CUSTOMER' };
  },
  requireRole: () => async () => {},
  requireUser: (request: { user?: { id: string; role: string } }) => request.user,
}));

const { createUsersRoutes } = await import('./routes.js');
type UsersUseCases = import('./routes.js').UsersUseCases;

const VERIFIED_AT = new Date('2026-01-15T10:30:00.000Z');
const CREATED_AT = new Date('2025-06-01T00:00:00.000Z');

function buildUseCases(overrides: Partial<UsersUseCases> = {}): UsersUseCases {
  return {
    getMyProfile: async () => ({
      id: AUTH_USER_ID,
      email: 'user@example.com',
      role: 'CUSTOMER',
      emailVerifiedAt: null,
      createdAt: CREATED_AT,
      wallets: [],
    }),
    requestWalletLinkChallenge: async () => ({ challenge: 'challenge' }),
    confirmWalletLink: async () => ({
      id: randomUUID(),
      address: 'GONE',
      isPrimary: false,
      verifiedAt: null,
    }),
    listWallets: async () => [],
    unlinkWallet: async () => undefined,
    setPrimaryWallet: async () => ({
      id: randomUUID(),
      address: 'GONE',
      isPrimary: true,
      verifiedAt: null,
    }),
    ...overrides,
  } as UsersUseCases;
}

async function inject(useCases: UsersUseCases, url: string) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createUsersRoutes(useCases));
  const response = await app.inject({
    method: 'GET',
    url,
    headers: { authorization: 'Bearer synthetic' },
  });
  await app.close();
  return response;
}

describe('GET /users/me wallet date serialization', () => {
  it('serializes a populated verification date and a false primary flag', async () => {
    const walletId = randomUUID();
    const useCases = buildUseCases({
      getMyProfile: async () => ({
        id: AUTH_USER_ID,
        email: 'user@example.com',
        role: 'CUSTOMER',
        emailVerifiedAt: VERIFIED_AT,
        createdAt: CREATED_AT,
        wallets: [
          { id: walletId, address: 'GREAL...', isPrimary: false, verifiedAt: VERIFIED_AT },
        ],
      }),
    });

    const response = await inject(useCases, '/users/me');

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.emailVerifiedAt).toBe('2026-01-15T10:30:00.000Z');
    expect(body.createdAt).toBe('2025-06-01T00:00:00.000Z');
    expect(body.wallets).toEqual([
      { id: walletId, address: 'GREAL...', isPrimary: false, verifiedAt: '2026-01-15T10:30:00.000Z' },
    ]);
  });

  it('serializes a null verification date as null, not omitted or undefined', async () => {
    const walletId = randomUUID();
    const useCases = buildUseCases({
      getMyProfile: async () => ({
        id: AUTH_USER_ID,
        email: 'user@example.com',
        role: 'CUSTOMER',
        emailVerifiedAt: null,
        createdAt: CREATED_AT,
        wallets: [{ id: walletId, address: 'GNULL...', isPrimary: false, verifiedAt: null }],
      }),
    });

    const response = await inject(useCases, '/users/me');

    expect(response.statusCode).toBe(200);
    const body = response.json().data;
    expect(body.emailVerifiedAt).toBeNull();
    expect('emailVerifiedAt' in body).toBe(true);
    expect(body.wallets[0].verifiedAt).toBeNull();
    expect('verifiedAt' in body.wallets[0]).toBe(true);
  });
});

describe('GET /users/me/wallets date serialization', () => {
  it('serializes the same wallet shape consistently, including a populated date', async () => {
    const walletId = randomUUID();
    const useCases = buildUseCases({
      listWallets: async () => [
        { id: walletId, address: 'GREAL...', isPrimary: false, verifiedAt: VERIFIED_AT },
      ],
    });

    const response = await inject(useCases, '/users/me/wallets');

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([
      { id: walletId, address: 'GREAL...', isPrimary: false, verifiedAt: '2026-01-15T10:30:00.000Z' },
    ]);
  });

  it('serializes a null verification date as null and keeps a false primary flag', async () => {
    const walletId = randomUUID();
    const useCases = buildUseCases({
      listWallets: async () => [
        { id: walletId, address: 'GNULL...', isPrimary: false, verifiedAt: null },
      ],
    });

    const response = await inject(useCases, '/users/me/wallets');

    expect(response.statusCode).toBe(200);
    const wallet = response.json().data[0];
    expect(wallet.verifiedAt).toBeNull();
    expect(wallet.isPrimary).toBe(false);
  });
});
