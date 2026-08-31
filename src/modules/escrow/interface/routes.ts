import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import type { Escrow } from '../domain/index.js';
import type {
  createBuildEscrowTransactionsUseCases,
  createGetEscrowUseCase,
} from '../application/index.js';
import {
  createEscrowBodySchema,
  escrowIdParamsSchema,
  getEscrowResponseSchema,
  refundEscrowBodySchema,
  releaseEscrowBodySchema,
  transactionResponseSchema,
} from './schemas.js';

export interface EscrowUseCases {
  getEscrow: ReturnType<typeof createGetEscrowUseCase>;
  buildTransactions: ReturnType<typeof createBuildEscrowTransactionsUseCases>;
}

function serializeEscrow(escrow: Escrow) {
  return {
    id: escrow.id,
    chainDeliveryId: escrow.chainDeliveryId.toString(),
    senderAddress: escrow.senderAddress,
    recipientAddress: escrow.recipientAddress,
    driverAddress: escrow.driverAddress,
    token: escrow.token,
    amount: escrow.amount.toString(),
    platformFee: escrow.platformFee?.toString() ?? null,
    status: escrow.status,
    disputedBy: escrow.disputedBy,
    disputedAt: escrow.disputedAt?.toISOString() ?? null,
    releasedAt: escrow.releasedAt?.toISOString() ?? null,
    refundedAt: escrow.refundedAt?.toISOString() ?? null,
    createdAtChain: escrow.createdAtChain.toISOString(),
  };
}

export function createEscrowRoutes(useCases: EscrowUseCases): FastifyPluginAsyncZod {
  return async function escrowRoutes(app) {
    app.get(
      '/escrow/:chainDeliveryId',
      { schema: { params: escrowIdParamsSchema, response: { 200: getEscrowResponseSchema } } },
      async (request, reply) => {
        const escrow = await useCases.getEscrow({
          chainDeliveryId: BigInt(request.params.chainDeliveryId),
        });
        void reply.status(200).send(ok(serializeEscrow(escrow)));
      },
    );

    app.post(
      '/transactions/build/create-escrow',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: createEscrowBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildCreateEscrowTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
          amount: BigInt(request.body.amount),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/release-escrow',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: releaseEscrowBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildReleaseEscrowTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/refund-escrow',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: refundEscrowBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildRefundEscrowTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
