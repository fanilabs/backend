import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import type { FleetDriver, FleetWithDrivers } from '../domain/index.js';
import type {
  createBuildFleetTransactionsUseCases,
  createGetFleetUseCase,
  createGetPayoutAddressUseCase,
} from '../application/index.js';
import {
  acceptFleetInviteBodySchema,
  addDriverToFleetBodySchema,
  fleetIdParamsSchema,
  getFleetResponseSchema,
  payoutAddressParamsSchema,
  payoutAddressResponseSchema,
  registerFleetBodySchema,
  removeDriverFromFleetBodySchema,
  transactionResponseSchema,
  updateFleetTreasuryBodySchema,
} from './schemas.js';

export interface FleetUseCases {
  getFleet: ReturnType<typeof createGetFleetUseCase>;
  getPayoutAddress: ReturnType<typeof createGetPayoutAddressUseCase>;
  buildTransactions: ReturnType<typeof createBuildFleetTransactionsUseCases>;
}

function serializeFleetDriver(driver: FleetDriver) {
  return {
    id: driver.id,
    driverAddress: driver.driverAddress,
    status: driver.status,
    invitedAt: driver.invitedAt.toISOString(),
    acceptedAt: driver.acceptedAt?.toISOString() ?? null,
    removedAt: driver.removedAt?.toISOString() ?? null,
  };
}

function serializeFleet(fleet: FleetWithDrivers) {
  return {
    id: fleet.id,
    chainFleetId: fleet.chainFleetId.toString(),
    ownerAddress: fleet.ownerAddress,
    treasuryAddress: fleet.treasuryAddress,
    createdAt: fleet.createdAt.toISOString(),
    updatedAt: fleet.updatedAt.toISOString(),
    drivers: fleet.drivers.map(serializeFleetDriver),
    totalActiveDrivers: fleet.totalActiveDrivers,
  };
}

export function createFleetRoutes(useCases: FleetUseCases): FastifyPluginAsyncZod {
  return async function fleetRoutes(app) {
    app.get(
      '/fleets/:chainFleetId',
      { schema: { params: fleetIdParamsSchema, response: { 200: getFleetResponseSchema } } },
      async (request, reply) => {
        const fleet = await useCases.getFleet({
          chainFleetId: BigInt(request.params.chainFleetId),
        });
        void reply.status(200).send(ok(serializeFleet(fleet)));
      },
    );

    app.get(
      '/fleets/:chainFleetId/payout-address/:driverAddress',
      {
        schema: {
          params: payoutAddressParamsSchema,
          response: { 200: payoutAddressResponseSchema },
        },
      },
      async (request, reply) => {
        const payoutAddress = await useCases.getPayoutAddress({
          chainFleetId: BigInt(request.params.chainFleetId),
          driverAddress: request.params.driverAddress,
        });
        void reply.status(200).send(ok({ payoutAddress }));
      },
    );

    app.post(
      '/transactions/build/register-fleet',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: registerFleetBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildRegisterFleetTransaction(
          request.body,
        );
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/update-fleet-treasury',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: updateFleetTreasuryBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildUpdateFleetTreasuryTransaction({
          ...request.body,
          chainFleetId: BigInt(request.body.chainFleetId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/add-driver-to-fleet',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: addDriverToFleetBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildAddDriverToFleetTransaction({
          ...request.body,
          chainFleetId: BigInt(request.body.chainFleetId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/accept-fleet-invite',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: acceptFleetInviteBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildAcceptFleetInviteTransaction({
          ...request.body,
          chainFleetId: BigInt(request.body.chainFleetId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/remove-driver-from-fleet',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: removeDriverFromFleetBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildRemoveDriverFromFleetTransaction({
          ...request.body,
          chainFleetId: BigInt(request.body.chainFleetId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
