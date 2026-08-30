import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireUser } from '../../../shared/http/index.js';
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

export function createUsersRoutes(useCases: UsersUseCases): FastifyPluginAsyncZod {
  return async function usersRoutes(app) {
    app.get(
      '/users/me',
      {
        preHandler: authenticate,
        schema: { security: [{ bearerAuth: [] }], response: { 200: profileResponseSchema } },
      },
      async (request, reply) => {
        const profile = await useCases.getMyProfile({ userId: requireUser(request).id });
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
      {
        preHandler: authenticate,
        schema: { security: [{ bearerAuth: [] }], response: { 200: listWalletsResponseSchema } },
      },
      async (request, reply) => {
        const wallets = await useCases.listWallets({ userId: requireUser(request).id });
        void reply.status(200).send(ok(wallets.map(serializeWallet)));
      },
    );

    app.post(
      '/users/me/wallets/challenge',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: requestChallengeBodySchema,
          response: { 200: requestChallengeResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await useCases.requestWalletLinkChallenge({
          userId: requireUser(request).id,
          address: request.body.address,
        });
        void reply.status(200).send(ok(result));
      },
    );

    app.post(
      '/users/me/wallets/confirm',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: confirmWalletBodySchema,
          response: { 200: walletResponseSchema },
        },
      },
      async (request, reply) => {
        const wallet = await useCases.confirmWalletLink({
          userId: requireUser(request).id,
          ...request.body,
        });
        void reply.status(200).send(ok(serializeWallet(wallet)));
      },
    );

    app.delete(
      '/users/me/wallets/:id',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          params: walletIdParamsSchema,
          response: { 200: emptyDataResponseSchema },
        },
      },
      async (request, reply) => {
        await useCases.unlinkWallet({
          userId: requireUser(request).id,
          walletId: request.params.id,
        });
        void reply.status(200).send(ok({}));
      },
    );
  };
}
