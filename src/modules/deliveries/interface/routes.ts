import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import type { Delivery } from '../domain/index.js';
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

function serializeDelivery(delivery: Delivery) {
  return {
    id: delivery.id,
    chainDeliveryId: delivery.chainDeliveryId.toString(),
    senderAddress: delivery.senderAddress,
    recipientAddress: delivery.recipientAddress,
    driverAddress: delivery.driverAddress,
    status: delivery.status,
    origin: delivery.origin,
    destination: delivery.destination,
    cargoCategory: delivery.cargoCategory,
    weightGrams: delivery.weightGrams,
    fragile: delivery.fragile,
    createdAtChain: delivery.createdAtChain.toISOString(),
    transitStartedAt: delivery.transitStartedAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}

export function createDeliveriesRoutes(useCases: DeliveriesUseCases): FastifyPluginAsyncZod {
  return async function deliveriesRoutes(app) {
    app.get(
      '/deliveries',
      {
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
      { schema: { params: deliveryIdParamsSchema, response: { 200: getDeliveryResponseSchema } } },
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
        preHandler: authenticate,
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

    app.post(
      '/transactions/build/raise-dispute',
      {
        preHandler: authenticate,
        schema: { body: raiseDisputeBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildRaiseDisputeTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
