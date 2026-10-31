import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireRole, requireUser } from '../../../shared/http/index.js';
import type { EvidenceWithVerification, GetDisputeResult } from '../application/index.js';
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

/** Maps a (safe) content type to the file extension appended to the evidence
 * download filename so desktop OS viewers can open the file directly (#390).
 * Unrecognized types fall back to `.bin`. */
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'audio/mpeg': '.mp3',
  'video/mp4': '.mp4',
};

function extensionForContentType(contentType: string): string {
  return CONTENT_TYPE_EXTENSIONS[contentType] ?? '.bin';
}

/** `toISOString()` throws `RangeError` on an invalid `Date`, so a single corrupt
 * nullable `resolvedAt` would otherwise turn the whole `getDispute` response
 * into a 500 (#293). An invalid date serializes to `null` (the schema's own
 * nullable value) instead of taking the endpoint down. */
function toIsoStringOrNull(date: Date | null | undefined): string | null {
  if (!date) return null;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
    resolvedAt: toIsoStringOrNull(result.dispute.resolvedAt),
    senderShareBps: result.dispute.senderShareBps,
    evidence: result.evidence.map(serializeEvidence),
  };
}

/** Upper bound for the raw JSON request body of the evidence upload route.
 * Base64 inflates the binary payload by ~4/3, so the transport limit must sit
 * above `evidenceMaxBytes` to leave room for the JSON envelope (contentType,
 * uploadedBy, etc.). Fastify rejects larger bodies with HTTP 413 before the
 * full JSON string is buffered into the V8 heap (#393). */
const EVIDENCE_UPLOAD_BODY_LIMIT = 15 * 1024 * 1024;

export function createDisputeRoutes(
  useCases: DisputeUseCases,
  config: DisputeRoutesConfig,
): FastifyPluginAsyncZod {
  const uploadEvidenceBodySchemaWithLimit = createUploadEvidenceBodySchema(config.evidenceMaxBytes);
  return async function disputeRoutes(app) {
    app.get(
      '/disputes/:chainDeliveryId',
      { schema: { params: disputeIdParamsSchema, response: { 200: getDisputeResponseSchema } } },
      async (request, reply) => {
        const result = await useCases.getDispute({
          chainDeliveryId: request.params.chainDeliveryId,
        });
        void reply.status(200).send(ok(serializeDispute(result)));
      },
    );

    app.post(
      '/disputes/:chainDeliveryId/evidence',
      {
        preHandler: authenticate,
        bodyLimit: Math.max(EVIDENCE_UPLOAD_BODY_LIMIT, config.evidenceMaxBytes),
        schema: {
          security: [{ bearerAuth: [] }],
          params: disputeIdParamsSchema,
          body: uploadEvidenceBodySchemaWithLimit,
          response: { 200: uploadEvidenceResponseSchema },
        },
      },
      async (request, reply) => {
        const { evidence } = await useCases.uploadEvidence({
          chainDeliveryId: request.params.chainDeliveryId,
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
      {
        preHandler: authenticate,
        schema: { security: [{ bearerAuth: [] }], params: evidenceIdParamsSchema },
      },
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
        const safeContentType = allowedTypes.includes(contentType)
          ? contentType
          : 'application/octet-stream';
        const extension = extensionForContentType(safeContentType);
        void reply
          .status(200)
          .type(safeContentType)
          .header(
            'Content-Disposition',
            `attachment; filename="${request.params.evidenceId}${extension}"`,
          )
          .send(bytes);
      },
    );

    app.post(
      '/transactions/build/raise-dispute',
      {
        preHandler: authenticate,
        schema: {
          security: [{ bearerAuth: [] }],
          body: raiseDisputeBodySchema,
          response: { 200: transactionResponseSchema },
        },
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
          security: [{ bearerAuth: [] }],
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
        schema: {
          security: [{ bearerAuth: [] }],
          body: resolveDisputeBodySchema,
          response: { 200: transactionResponseSchema },
        },
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
        schema: {
          security: [{ bearerAuth: [] }],
          body: resolveDisputeBodySchema,
          response: { 200: transactionResponseSchema },
        },
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
        preHandler: [authenticate, requireRole('ADMIN')],
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
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
