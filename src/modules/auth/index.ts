import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  createLoginUseCase,
  createLogoutUseCase,
  createRefreshSessionUseCase,
  createRegisterUserUseCase,
  createRequestPasswordResetUseCase,
  createResetPasswordUseCase,
  createVerifyEmailUseCase,
} from './application/index.js';
import {
  createBcryptPasswordHasher,
  createJwtTokenService,
  createLoggerMailer,
  createPrismaRefreshTokenRepository,
  createPrismaUserRepository,
} from './infrastructure/index.js';
import { createAuthRoutes } from './interface/routes.js';

/**
 * Module composition root: wires the real infrastructure adapters into the
 * application use cases and returns a ready-to-register Fastify plugin.
 * This is the only file in the `auth` module allowed to see all four of its
 * layers (see eslint.config.js's `module-root` boundary) — everything
 * downstream of here only ever sees the ports/use cases it actually needs.
 */
export function createAuthModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const userRepository = createPrismaUserRepository(prisma);
  const refreshTokenRepository = createPrismaRefreshTokenRepository(prisma);
  const passwordHasher = createBcryptPasswordHasher();
  const tokenService = createJwtTokenService();
  const mailer = createLoggerMailer();

  const useCases = {
    registerUser: createRegisterUserUseCase({
      userRepository,
      passwordHasher,
      tokenService,
      mailer,
    }),
    login: createLoginUseCase({
      userRepository,
      passwordHasher,
      tokenService,
      refreshTokenRepository,
    }),
    refreshSession: createRefreshSessionUseCase({
      userRepository,
      refreshTokenRepository,
      tokenService,
      clock: { now: () => new Date() },
    }),
    logout: createLogoutUseCase({ refreshTokenRepository, tokenService }),
    verifyEmail: createVerifyEmailUseCase({ userRepository, tokenService }),
    requestPasswordReset: createRequestPasswordResetUseCase({
      userRepository,
      tokenService,
      mailer,
    }),
    resetPassword: createResetPasswordUseCase({
      userRepository,
      passwordHasher,
      tokenService,
      refreshTokenRepository,
    }),
  };

  return createAuthRoutes(useCases);
}
