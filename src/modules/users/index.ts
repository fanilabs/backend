import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  createConfirmWalletLinkUseCase,
  createGetMyProfileUseCase,
  createListWalletsUseCase,
  createRequestWalletLinkChallengeUseCase,
  createUnlinkWalletUseCase,
} from './application/index.js';
import {
  createJwtChallengeService,
  createPrismaUserReader,
  createPrismaWalletAddressRepository,
  createStellarSignatureVerifier,
} from './infrastructure/index.js';
import { createUsersRoutes } from './interface/routes.js';

export function createUsersModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const userReader = createPrismaUserReader(prisma);
  const walletAddressRepository = createPrismaWalletAddressRepository(prisma);
  const challengeService = createJwtChallengeService();
  const signatureVerifier = createStellarSignatureVerifier();

  const useCases = {
    getMyProfile: createGetMyProfileUseCase({ userReader, walletAddressRepository }),
    requestWalletLinkChallenge: createRequestWalletLinkChallengeUseCase({
      walletAddressRepository,
      challengeService,
    }),
    confirmWalletLink: createConfirmWalletLinkUseCase({
      walletAddressRepository,
      challengeService,
      signatureVerifier,
    }),
    listWallets: createListWalletsUseCase({ walletAddressRepository }),
    unlinkWallet: createUnlinkWalletUseCase({ walletAddressRepository }),
  };

  return createUsersRoutes(useCases);
}
