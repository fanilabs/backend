import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok } from '../../../shared/http/index.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import type { EvidenceWithVerification, GetDisputeResult } from '../application/index.js';
import type { UserRole } from '../domain/index.js';
import type {
  createBuildDisputeTransactionsUseCases,
  createDownloadEvidenceUseCase,
  createGetDisputeUseCase,
  createUploadEvidenceUseCase,
} from '../application/index.js';
import {
  addEvidenceHashBodySchema,
  createUploadEvidenceBodySchema,
  disputeIdParamsSchema,
  evidenceIdParamsSchema,
  getDisputeResponseSchema,
  raiseDisputeBodySchema,
  resolveDisputeBodySchema,
  resolveDisputeSplitFundsBodySchema,
  transactionResponseSchema,
  uploadEvidenceResponseSchema,
} from './schemas.js';

export interface DisputeUseCases {
  getDispute: ReturnType<typeof createGetDisputeUseCase>;
  uploadEvidence: ReturnType<typeof createUploadEvidenceUseCase>;
  downloadEvidence: ReturnType<typeof createDownloadEvidenceUseCase>;
  buildTransactions: ReturnType<typeof createBuildDisputeTransactionsUseCases>;
}

export interface DisputeRoutesConfig {
  evidenceMaxBytes: number;
}

function serializeEvidence(evidence: EvidenceWithVerification) {
  return {
    id: evidence.id,
    hash: evidence.hash,
    contentType: evidence.contentType,
    uploadedBy: evidence.uploadedBy,
    createdAt: evidence.createdAt.toISOString(),
    confirmedOnChain: evidence.confirmedOnChain,
  };
}

function serializeDispute(result: GetDisputeResult) {
  return {
    id: result.dispute.id,
    chainDeliveryId: result.dispute.chainDeliveryId.toString(),
    status: result.dispute.status,
    raisedBy: result.dispute.raisedBy,
    raisedAt: result.dispute.raisedAt.toISOString(),
    resolvedBy: result.dispute.resolvedBy,
    resolvedAt: result.dispute.resolvedAt?.toISOString() ?? null,
    senderShareBps: result.dispute.senderShareBps,
    evidence: result.evidence.map(serializeEvidence),
  };
}

function requireUser(request: { user?: { id: string; role: UserRole } }): {
  id: string;
  role: UserRole;
} {
  if (!request.user) {
    // Unreachable in practice — both routes below attach `authenticate` as
    // a preHandler, which throws before a handler body ever runs.
    throw new UnauthorizedError('Authentication required');
  }
  return request.user;
}

export function createDisputeRoutes(useCases: DisputeUseCases, config: DisputeRoutesConfig): FastifyPluginAsyncZod {
  const uploadEvidenceBodySchemaWithLimit = createUploadEvidenceBodySchema(config.evidenceMaxBytes);
  return async function disputeRoutes(app) {
    app.get(
      '/disputes/:chainDeliveryId',
      { schema: { params: disputeIdParamsSchema, response: { 200: getDisputeResponseSchema } } },
      async (request, reply) => {
        const result = await useCases.getDispute({
          chainDeliveryId: BigInt(request.params.chainDeliveryId),
        });
        void reply.status(200).send(ok(serializeDispute(result)));
      },
    );

    app.post(
      '/disputes/:chainDeliveryId/evidence',
      {
        preHandler: authenticate,
        schema: {
          params: disputeIdParamsSchema,
          body: uploadEvidenceBodySchemaWithLimit,
          response: { 200: uploadEvidenceResponseSchema },
        },
      },
      async (request, reply) => {
        const { evidence } = await useCases.uploadEvidence({
          chainDeliveryId: BigInt(request.params.chainDeliveryId),
          contentType: request.body.contentType,
          uploadedBy: request.body.uploadedBy,
          bytes: Buffer.from(request.body.base64Content, 'base64'),
          requesterId: requireUser(request).id,
        });
        void reply.status(200).send(ok({ evidenceId: evidence.id, hash: evidence.hash }));
      },
    );

    app.get(
      '/disputes/evidence/:evidenceId/download',
      { preHandler: authenticate, schema: { params: evidenceIdParamsSchema } },
      async (request, reply) => {
        const user = requireUser(request);
        const { contentType, bytes } = await useCases.downloadEvidence({
          evidenceId: request.params.evidenceId,
          requesterId: user.id,
          requesterRole: user.role,
        });
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf',
          'audio/mpeg',
          'video/mp4',
        ];
        const safeContentType = allowedTypes.includes(contentType) ? contentType : 'application/octet-stream';
        void reply
          .status(200)
          .type(safeContentType)
          .header('Content-Disposition', `attachment; filename="${request.params.evidenceId}"`)
          .send(bytes);
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

    app.post(
      '/transactions/build/add-evidence-hash',
      {
        preHandler: authenticate,
        schema: {
          body: addEvidenceHashBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildAddEvidenceHashTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/resolve-dispute-refund-sender',
      {
        preHandler: authenticate,
        schema: { body: resolveDisputeBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope =
          await useCases.buildTransactions.buildResolveDisputeRefundSenderTransaction({
            ...request.body,
            chainDeliveryId: BigInt(request.body.chainDeliveryId),
          });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/resolve-dispute-pay-driver',
      {
        preHandler: authenticate,
        schema: { body: resolveDisputeBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope =
          await useCases.buildTransactions.buildResolveDisputePayDriverTransaction({
            ...request.body,
            chainDeliveryId: BigInt(request.body.chainDeliveryId),
          });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/resolve-dispute-split-funds',
      {
        preHandler: authenticate,
        schema: {
          body: resolveDisputeSplitFundsBodySchema,
          response: { 200: transactionResponseSchema },
        },
      },
      async (request, reply) => {
        const xdrEnvelope =
          await useCases.buildTransactions.buildResolveDisputeSplitFundsTransaction({
            ...request.body,
            chainDeliveryId: BigInt(request.body.chainDeliveryId),
          });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
