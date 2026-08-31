import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import type { DriverProfile } from '../domain/index.js';
import type {
  createBuildReputationTransactionsUseCases,
  createGetDriverProfileUseCase,
} from '../application/index.js';
import {
  driverAddressParamsSchema,
  getDriverProfileResponseSchema,
  registerDriverBodySchema,
  transactionResponseSchema,
  updateDriverKycStatusBodySchema,
} from './schemas.js';

export interface ReputationUseCases {
  getDriverProfile: ReturnType<typeof createGetDriverProfileUseCase>;
  buildTransactions: ReturnType<typeof createBuildReputationTransactionsUseCases>;
}

function serializeDriverProfile(profile: DriverProfile) {
  return {
    id: profile.id,
    address: profile.address,
    reputationScore: profile.reputationScore,
    tier: profile.tier,
    kycVerified: profile.kycVerified,
    deliveriesCompleted: profile.deliveriesCompleted,
    legacyDeliveriesCompleted: profile.legacyDeliveriesCompleted,
    registeredAt: profile.registeredAt.toISOString(),
  };
}

export function createReputationRoutes(useCases: ReputationUseCases): FastifyPluginAsyncZod {
  return async function reputationRoutes(app) {
    app.get(
      '/drivers/:address/reputation',
      {
        schema: {
          params: driverAddressParamsSchema,
          response: { 200: getDriverProfileResponseSchema },
        },
      },
      async (request, reply) => {
        const profile = await useCases.getDriverProfile({ address: request.params.address });
        void reply.status(200).send(ok(serializeDriverProfile(profile)));
      },
    );

    app.post(
      '/transactions/build/register-driver',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: registerDriverBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildRegisterDriverTransaction(
          request.body,
        );
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/update-driver-kyc-status',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: updateDriverKycStatusBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildUpdateDriverKycStatusTransaction(
          request.body,
        );
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
