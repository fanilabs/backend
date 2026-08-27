import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ok } from '../../../shared/http/index.js';
import type {
  createLoginUseCase,
  createLogoutUseCase,
  createRefreshSessionUseCase,
  createRegisterUserUseCase,
  createRequestPasswordResetUseCase,
  createResetPasswordUseCase,
  createVerifyEmailUseCase,
} from '../application/index.js';
import {
  emptyDataResponseSchema,
  loginBodySchema,
  loginResponseSchema,
  logoutBodySchema,
  refreshBodySchema,
  refreshResponseSchema,
  registerBodySchema,
  registerResponseSchema,
  requestPasswordResetBodySchema,
  resetPasswordBodySchema,
  verifyEmailBodySchema,
} from './schemas.js';

export interface AuthUseCases {
  registerUser: ReturnType<typeof createRegisterUserUseCase>;
  login: ReturnType<typeof createLoginUseCase>;
  refreshSession: ReturnType<typeof createRefreshSessionUseCase>;
  logout: ReturnType<typeof createLogoutUseCase>;
  verifyEmail: ReturnType<typeof createVerifyEmailUseCase>;
  requestPasswordReset: ReturnType<typeof createRequestPasswordResetUseCase>;
  resetPassword: ReturnType<typeof createResetPasswordUseCase>;
}

/**
 * Thin HTTP layer — every handler validates via the Zod schema, delegates
 * to exactly one application-layer use case, and maps the result through
 * the shared response envelope. No business logic lives here (ARCHITECTURE.md §1).
 */
export function createAuthRoutes(useCases: AuthUseCases): FastifyPluginAsyncZod {
  return async function authRoutes(app) {
    app.post(
      '/auth/register',
      { schema: { body: registerBodySchema, response: { 201: registerResponseSchema } } },
      async (request, reply) => {
        const result = await useCases.registerUser(request.body);
        void reply.status(201).send(ok(result));
      },
    );

    app.post(
      '/auth/login',
      { schema: { body: loginBodySchema, response: { 200: loginResponseSchema } } },
      async (request, reply) => {
        const result = await useCases.login(request.body);
        void reply.status(200).send(
          ok({
            ...result,
            user: {
              ...result.user,
              emailVerifiedAt: result.user.emailVerifiedAt?.toISOString() ?? null,
            },
          }),
        );
      },
    );

    app.post(
      '/auth/refresh',
      { schema: { body: refreshBodySchema, response: { 200: refreshResponseSchema } } },
      async (request, reply) => {
        const result = await useCases.refreshSession(request.body);
        void reply.status(200).send(ok(result));
      },
    );

    app.post(
      '/auth/logout',
      { schema: { body: logoutBodySchema, response: { 200: emptyDataResponseSchema } } },
      async (request, reply) => {
        await useCases.logout(request.body);
        void reply.status(200).send(ok({}));
      },
    );

    app.post(
      '/auth/verify-email',
      { schema: { body: verifyEmailBodySchema, response: { 200: emptyDataResponseSchema } } },
      async (request, reply) => {
        await useCases.verifyEmail(request.body);
        void reply.status(200).send(ok({}));
      },
    );

    app.post(
      '/auth/request-password-reset',
      {
        schema: {
          body: requestPasswordResetBodySchema,
          response: { 200: emptyDataResponseSchema },
        },
      },
      async (request, reply) => {
        await useCases.requestPasswordReset(request.body);
        void reply.status(200).send(ok({}));
      },
    );

    app.post(
      '/auth/reset-password',
      { schema: { body: resetPasswordBodySchema, response: { 200: emptyDataResponseSchema } } },
      async (request, reply) => {
        await useCases.resetPassword(request.body);
        void reply.status(200).send(ok({}));
      },
    );
  };
}
