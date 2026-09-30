import { Keypair } from '@stellar/stellar-sdk';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { createDisputeRoutes, type DisputeUseCases } from './routes.js';
import { buildDispute } from '../application/__fixtures__/fakes.js';
import type { GetDisputeResult } from '../application/index.js';

/** Minimal stub set — only `getDispute` is exercised; the other use cases are
 * never invoked by the `GET /disputes/:chainDeliveryId` route under test. */
function buildUseCases(dispute: GetDisputeResult['dispute']): DisputeUseCases {
  const getDispute = async (): Promise<GetDisputeResult> => ({ dispute, evidence: [] });
  return {
    getDispute,
    uploadEvidence: getDispute,
    downloadEvidence: getDispute,
    buildTransactions: {
      buildRaiseDisputeTransaction: getDispute,
      buildAddEvidenceHashTransaction: getDispute,
      buildResolveDisputeRefundSenderTransaction: getDispute,
      buildResolveDisputePayDriverTransaction: getDispute,
      buildResolveDisputeSplitFundsTransaction: getDispute,
    },
  } as unknown as DisputeUseCases;
}

/** `buildDispute`'s default `raisedBy` is a placeholder that doesn't satisfy the
 * `stellarAddress` shape the response schema enforces, so every dispute built
 * here carries a real, randomly generated address instead. */
const RAISER = Keypair.random().publicKey();

async function getDisputeResponse(dispute: GetDisputeResult['dispute']) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createDisputeRoutes(buildUseCases(dispute), { evidenceMaxBytes: 1024 }));
  const response = await app.inject({ method: 'GET', url: '/disputes/1' });
  await app.close();
  if (response.statusCode !== 200) {
    throw new Error(`GET /disputes/1 -> ${response.statusCode}: ${response.body}`);
  }
  return response;
}

describe('GET /disputes/:chainDeliveryId serialization (#293)', () => {
  it('serializes a valid resolvedAt as an ISO string', async () => {
    const resolvedAt = new Date('2026-03-01T00:00:00Z');

    const response = await getDisputeResponse(buildDispute({ raisedBy: RAISER, resolvedAt }));

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resolvedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('serializes a null resolvedAt as null', async () => {
    const response = await getDisputeResponse(buildDispute({ raisedBy: RAISER, resolvedAt: null }));

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resolvedAt).toBeNull();
  });

  it('serializes an invalid resolvedAt as null instead of throwing (#293)', async () => {
    const response = await getDisputeResponse(
      buildDispute({ raisedBy: RAISER, resolvedAt: new Date('nope') }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resolvedAt).toBeNull();
  });
});
