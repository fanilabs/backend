import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import type { WalletAddressRecord } from '../domain/index.js';
import type {
  createConfirmWalletLinkUseCase,
  createGetMyProfileUseCase,
  createListWalletsUseCase,
  createRequestWalletLinkChallengeUseCase,
  createUnlinkWalletUseCase,
} from '../application/index.js';
import {
  confirmWalletBodySchema,
  emptyDataResponseSchema,
  listWalletsResponseSchema,
  profileResponseSchema,
  requestChallengeBodySchema,
  requestChallengeResponseSchema,
  walletIdParamsSchema,
  walletResponseSchema,
} from './schemas.js';

export interface UsersUseCases {
  getMyProfile: ReturnType<typeof createGetMyProfileUseCase>;
  requestWalletLinkChallenge: ReturnType<typeof createRequestWalletLinkChallengeUseCase>;
  confirmWalletLink: ReturnType<typeof createConfirmWalletLinkUseCase>;
  listWallets: ReturnType<typeof createListWalletsUseCase>;
  unlinkWallet: ReturnType<typeof createUnlinkWalletUseCase>;
}

function serializeWallet(wallet: WalletAddressRecord) {
  return {
    id: wallet.id,
    address: wallet.address,
    isPrimary: wallet.isPrimary,
    verifiedAt: wallet.verifiedAt?.toISOString() ?? null,
  };
}

function requireUserId(request: { user?: { id: string } }): string {
  if (!request.user) {
    // Unreachable in practice — every route below attaches `authenticate`
    // as a preHandler, which throws before a handler body ever runs. This
    // exists so `request.user.id` is never accessed through a non-null
    // assertion further down.
    throw new UnauthorizedError('Authentication required');
  }
  return request.user.id;
}

export function createUsersRoutes(useCases: UsersUseCases): FastifyPluginAsyncZod {
  return async function usersRoutes(app) {
    app.get(
      '/users/me',
      { preHandler: authenticate, schema: { response: { 200: profileResponseSchema } } },
      async (request, reply) => {
        const profile = await useCases.getMyProfile({ userId: requireUserId(request) });
        void reply.status(200).send(
          ok({
            ...profile,
            emailVerifiedAt: profile.emailVerifiedAt?.toISOString() ?? null,
            createdAt: profile.createdAt.toISOString(),
            wallets: profile.wallets.map((wallet) => ({
              ...wallet,
              verifiedAt: wallet.verifiedAt?.toISOString() ?? null,
            })),
          }),
        );
      },
    );

    app.get(
      '/users/me/wallets',
      { preHandler: authenticate, schema: { response: { 200: listWalletsResponseSchema } } },
      async (request, reply) => {
        const wallets = await useCases.listWallets({ userId: requireUserId(request) });
        void reply.status(200).send(ok(wallets.map(serializeWallet)));
      },
    );

    app.post(
      '/users/me/wallets/challenge',
      {
        preHandler: authenticate,
        schema: {
          body: requestChallengeBodySchema,
          response: { 200: requestChallengeResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await useCases.requestWalletLinkChallenge({
          userId: requireUserId(request),
          address: request.body.address,
        });
        void reply.status(200).send(ok(result));
      },
    );

    app.post(
      '/users/me/wallets/confirm',
      {
        preHandler: authenticate,
        schema: { body: confirmWalletBodySchema, response: { 200: walletResponseSchema } },
      },
      async (request, reply) => {
        const wallet = await useCases.confirmWalletLink({
          userId: requireUserId(request),
          ...request.body,
        });
        void reply.status(200).send(ok(serializeWallet(wallet)));
      },
    );

    app.delete(
      '/users/me/wallets/:id',
      {
        preHandler: authenticate,
        schema: { params: walletIdParamsSchema, response: { 200: emptyDataResponseSchema } },
      },
      async (request, reply) => {
        await useCases.unlinkWallet({
          userId: requireUserId(request),
          walletId: request.params.id,
        });
        void reply.status(200).send(ok({}));
      },
    );
  };
}
