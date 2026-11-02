import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireUser } from '../../../shared/http/index.js';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import type { WalletAddressRepository } from '../../users/domain/index.js';
import { serializeDelivery } from '../domain/index.js';
import type {
  createBuildDeliveryTransactionsUseCases,
  createGetDeliveryUseCase,
  createListDeliveriesUseCase,
} from '../application/index.js';
import {
  assignDriverBodySchema,
  cancelDeliveryBodySchema,
  confirmDeliveryBodySchema,
  createDeliveryBodySchema,
  deliveryIdParamsSchema,
  getDeliveryResponseSchema,
  listDeliveriesQuerySchema,
  listDeliveriesResponseSchema,
  markInTransitBodySchema,
  raiseDisputeBodySchema,
  transactionResponseSchema,
} from './schemas.js';

export interface DeliveriesUseCases {
  listDeliveries: ReturnType<typeof createListDeliveriesUseCase>;
  getDelivery: ReturnType<typeof createGetDeliveryUseCase>;
  buildTransactions: ReturnType<typeof createBuildDeliveryTransactionsUseCases>;
}

export interface DeliveriesRoutesConfig {
  walletAddressRepository: WalletAddressRepository;
}

/** Ownership belongs to the shared wallet-linking repository. Check it before
 * building the two caller-address transactions, as required by #381. */
async function ensureCallerOwnedByUser(
  config: DeliveriesRoutesConfig,
  userId: string,
  callerAddress: string,
): Promise<void> {
  const wallet = await config.walletAddressRepository.findByAddress(callerAddress);
  if (!wallet || wallet.userId !== userId) {
    throw new ForbiddenError('Caller address is not linked to your account');
  }
}

export function createDeliveriesRoutes(
  useCases: DeliveriesUseCases,
  config: DeliveriesRoutesConfig,
): FastifyPluginAsyncZod {
  return async function deliveriesRoutes(app) {
    app.get(
      '/deliveries',
      {
        preHandler: authenticate,
        schema: {
          querystring: listDeliveriesQuerySchema,
          response: { 200: listDeliveriesResponseSchema },
        },
      },
      async (request, reply) => {
        const { senderAddress, recipientAddress, driverAddress, status } = request.query;
        const deliveries = await useCases.listDeliveries({
          ...(senderAddress && { senderAddress }),
          ...(recipientAddress && { recipientAddress }),
          ...(driverAddress && { driverAddress }),
          ...(status && { status }),
        });
        void reply.status(200).send(ok(deliveries.map(serializeDelivery)));
      },
    );

    app.get(
      '/deliveries/:chainDeliveryId',
      {
        preHandler: authenticate,
        schema: { params: deliveryIdParamsSchema, response: { 200: getDeliveryResponseSchema } },
      },
      async (request, reply) => {
        const delivery = await useCases.getDelivery({
          chainDeliveryId: BigInt(request.params.chainDeliveryId),
        });
        void reply.status(200).send(ok(serializeDelivery(delivery)));
      },
    );

    app.post(
      '/transactions/build/create-delivery',
      {
        preHandler: authenticate,
        schema: { body: createDeliveryBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildCreateDeliveryTransaction({
          ...request.body,
          estimatedDelivery: new Date(request.body.estimatedDelivery),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/assign-driver',
      {
        preHandler: authenticate,
        schema: { body: assignDriverBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        await ensureCallerOwnedByUser(config, requireUser(request).id, request.body.callerAddress);
        const xdrEnvelope = await useCases.buildTransactions.buildAssignDriverTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/mark-in-transit',
      {
        preHandler: authenticate,
        schema: { body: markInTransitBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildMarkInTransitTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/confirm-delivery',
      {
        onRequest: [authenticate],
        schema: { body: confirmDeliveryBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildConfirmDeliveryTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/cancel-delivery',
      {
        preHandler: authenticate,
        schema: { body: cancelDeliveryBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildCancelDeliveryTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    // Deliberately `raise-delivery-dispute`, not `raise-dispute`: this builds
    // an invocation of `delivery_contract.raise_dispute` (Layer A — pauses
    // the delivery/escrow, cross-calling `escrow_contract.raise_dispute`;
    // PHASE_1_DOMAIN_ANALYSIS.md §10's call graph), a genuinely different
    // on-chain action from the `disputes` module's own
    // `POST /transactions/build/raise-dispute`, which invokes
    // `dispute_resolution_contract.raise_dispute` (Layer B — creates the
    // richer arbitration `DisputeCase` with evidence support, and itself
    // cross-calls this same `delivery_contract.raise_dispute` when
    // applicable). The two routes collided under the identical path before
    // this rename (`FST_ERR_DUPLICATED_ROUTE`, crashing `buildApp()`) — see
    // `tests/e2e/app.e2e.spec.ts`'s regression test. `disputes` keeps the
    // shorter, canonical path since it owns the complete dispute lifecycle
    // (raise → evidence → resolve) as one cohesive, already-tested REST
    // surface; this endpoint's request/response shape and behavior are
    // otherwise completely unchanged.
    app.post(
      '/transactions/build/raise-delivery-dispute',
      {
        preHandler: authenticate,
        schema: { body: raiseDisputeBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        await ensureCallerOwnedByUser(config, requireUser(request).id, request.body.callerAddress);
        const xdrEnvelope = await useCases.buildTransactions.buildRaiseDisputeTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
