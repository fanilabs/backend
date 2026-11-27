import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { disconnectPrisma, getPrismaClient } from '../../../shared/database/index.js';
import { signAccessToken } from '../../../shared/jwt/index.js';
import { createDisputeRoutes, type DisputeUseCases } from './routes.js';

const EVIDENCE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const EVIDENCE_BYTES = Buffer.from('evidence-bytes');

async function unexpectedUseCase(): Promise<never> {
  throw new Error('Unexpected use case in the download route test');
}

describe('GET /disputes/evidence/:evidenceId/download', () => {
  let app: FastifyInstance | undefined;
  let requesterId: string | undefined;
  let authorization: string;

  beforeAll(async () => {
    const user = await getPrismaClient().user.create({
      data: {
        email: `${randomUUID()}@dispute-download.invalid`,
        passwordHash: 'fixture-only',
        role: 'CUSTOMER',
      },
      select: { id: true, role: true, tokenVersion: true },
    });
    requesterId = user.id;
    authorization = `Bearer ${signAccessToken({
      sub: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    })}`;
  });

  afterEach(async () => {
    await app?.close();
  });

  afterAll(async () => {
    try {
      if (requesterId) {
        await getPrismaClient().user.deleteMany({ where: { id: requesterId } });
      }
    } finally {
      await disconnectPrisma();
    }
  });

  it.each([
    { contentType: 'image/jpeg', extension: 'jpg', expectedContentType: 'image/jpeg' },
    { contentType: 'image/png', extension: 'png', expectedContentType: 'image/png' },
    { contentType: 'application/pdf', extension: 'pdf', expectedContentType: 'application/pdf' },
    { contentType: 'video/mp4', extension: 'mp4', expectedContentType: 'video/mp4' },
    {
      contentType: 'application/x-unknown',
      extension: 'bin',
      expectedContentType: 'application/octet-stream',
    },
  ])(
    'serves $contentType evidence as .$extension',
    async ({ contentType, extension, expectedContentType }) => {
      const downloadEvidence = vi.fn<DisputeUseCases['downloadEvidence']>(async () => ({
        contentType,
        bytes: EVIDENCE_BYTES,
      }));
      const useCases: DisputeUseCases = {
        getDispute: unexpectedUseCase,
        uploadEvidence: unexpectedUseCase,
        downloadEvidence,
        buildTransactions: {
          buildRaiseDisputeTransaction: unexpectedUseCase,
          buildAddEvidenceHashTransaction: unexpectedUseCase,
          buildResolveDisputeRefundSenderTransaction: unexpectedUseCase,
          buildResolveDisputePayDriverTransaction: unexpectedUseCase,
          buildResolveDisputeSplitFundsTransaction: unexpectedUseCase,
        },
      };

      app = Fastify();
      app.setValidatorCompiler(validatorCompiler);
      app.setSerializerCompiler(serializerCompiler);
      await app.register(createDisputeRoutes(useCases, { evidenceMaxBytes: 1024 }));

      const response = await app.inject({
        method: 'GET',
        url: `/disputes/evidence/${EVIDENCE_ID}/download`,
        headers: { authorization },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${EVIDENCE_ID}.${extension}"`,
      );
      expect(response.headers['content-type']).toBe(expectedContentType);
      expect(response.rawPayload).toEqual(EVIDENCE_BYTES);
      expect(downloadEvidence).toHaveBeenCalledExactlyOnceWith({
        evidenceId: EVIDENCE_ID,
        requesterId,
        requesterRole: 'CUSTOMER',
      });
    },
  );
});
