import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
import { signAccessToken } from '../../../shared/jwt/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('escrow routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdChainIds: bigint[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.escrow.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  // Escrow.chainDeliveryId is a foreign key into Delivery.chainDeliveryId, so
  // every seeded escrow needs its parent delivery row created first.
  async function seedEscrow() {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
        status: 'PENDING',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    await prisma.escrow.create({
      data: {
        chainDeliveryId,
        senderAddress: `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
        driverAddress: `GDRIVER-${randomUUID()}`,
        token: `GTOKEN-${randomUUID()}`,
        amount: '1000000',
        status: 'LOCKED',
        createdAtChain: new Date(),
      },
    });
    return chainDeliveryId;
  }

  it('gets a single escrow by chain delivery id', async () => {
    const chainDeliveryId = await seedEscrow();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/escrow/${chainDeliveryId.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ status: string; chainDeliveryId: string }>>();
    expect(body.data.status).toBe('LOCKED');
    expect(body.data.chainDeliveryId).toBe(chainDeliveryId.toString());
  });

  it('returns 404 for an unknown escrow', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/escrow/999999999999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/release-escrow',
      payload: { callerAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  // docs/API_REFERENCE.md: with ESCROW_CONTRACT_ID unset (its .env.example
  // default, and the default in this test process), the build endpoints must
  // return 502 BLOCKCHAIN_ERROR naming the missing variable — the
  // createUnconfiguredContractClient() fallback in ../index.ts — rather than
  // a generic failure. Fails if that fallback wiring is removed.
  it('returns 502 BLOCKCHAIN_ERROR from a build endpoint when the contract id is unconfigured', async () => {
    const token = signAccessToken({ sub: randomUUID(), role: 'ADMIN' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/release-escrow',
      headers: { authorization: `Bearer ${token}` },
      payload: { callerAddress: Keypair.random().publicKey(), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('BLOCKCHAIN_ERROR');
    expect(body.error.message).toContain('ESCROW_CONTRACT_ID');
  });
});
