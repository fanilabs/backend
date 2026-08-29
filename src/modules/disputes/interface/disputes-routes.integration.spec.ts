import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('dispute routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdChainIds: bigint[] = [];
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.evidence.deleteMany({
        where: { dispute: { chainDeliveryId: { in: createdChainIds } } },
      });
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    if (createdEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.walletAddress.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  /** Registers a real account, logs in for a real access token, and links
   * a fresh Stellar address to it directly via Prisma (the wallet-linking
   * challenge/signature flow itself is covered by `users`' own integration
   * tests — this just needs a real, owned `wallet_addresses` row). */
  async function registerWithWallet(
    role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER',
  ): Promise<{ accessToken: string; userId: string; address: string }> {
    const email = `dispute-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    }
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const address = Keypair.random().publicKey();
    await prisma.walletAddress.create({
      data: { userId: user.id, address, isPrimary: true, verifiedAt: new Date() },
    });
    return {
      accessToken: login.json<SuccessBody<{ accessToken: string }>>().data.accessToken,
      userId: user.id,
      address,
    };
  }

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  // Dispute.chainDeliveryId is a foreign key into Delivery.chainDeliveryId,
  // so every seeded dispute needs its parent delivery row created first.
  async function seedDispute(raisedBy = `GRAISER-${randomUUID()}`) {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
        status: 'DISPUTED',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    await prisma.dispute.create({
      data: { chainDeliveryId, status: 'OPEN', raisedBy, raisedAt: new Date() },
    });
    return chainDeliveryId;
  }

  it('gets a single dispute by chain delivery id, with an empty evidence list', async () => {
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ status: string; evidence: unknown[] }>>();
    expect(body.data.status).toBe('OPEN');
    expect(body.data.evidence).toEqual([]);
  });

  it('returns 404 for an unknown dispute', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/disputes/999999999999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated evidence upload', async () => {
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}/evidence`,
      payload: {
        uploadedBy: 'G'.padEnd(56, 'A'),
        contentType: 'image/png',
        base64Content: Buffer.from('fake').toString('base64'),
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/raise-dispute',
      payload: { callerAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects uploading evidence attributed to an address the requester does not own', async () => {
    const chainDeliveryId = await seedDispute();
    const attacker = await registerWithWallet();
    const victimAddress = Keypair.random().publicKey();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}/evidence`,
      headers: { authorization: `Bearer ${attacker.accessToken}` },
      payload: {
        uploadedBy: victimAddress,
        contentType: 'image/png',
        base64Content: Buffer.from('fake').toString('base64'),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('allows uploading evidence attributed to an address the requester owns, and restricts who can download it', async () => {
    const chainDeliveryId = await seedDispute();
    const uploader = await registerWithWallet();
    const stranger = await registerWithWallet();

    const uploadResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}/evidence`,
      headers: { authorization: `Bearer ${uploader.accessToken}` },
      payload: {
        uploadedBy: uploader.address,
        contentType: 'image/png',
        base64Content: Buffer.from('real-evidence').toString('base64'),
      },
    });
    expect(uploadResponse.statusCode).toBe(200);
    const evidenceId = uploadResponse.json<SuccessBody<{ evidenceId: string }>>().data.evidenceId;

    const strangerDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/evidence/${evidenceId}/download`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    });
    expect(strangerDownload.statusCode).toBe(403);

    const ownerDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/evidence/${evidenceId}/download`,
      headers: { authorization: `Bearer ${uploader.accessToken}` },
    });
    expect(ownerDownload.statusCode).toBe(200);
    expect(ownerDownload.body).toBe('real-evidence');
  });

  it("allows the dispute's raiser to download evidence someone else uploaded, and always allows ADMIN", async () => {
    const raiser = await registerWithWallet();
    const chainDeliveryId = await seedDispute(raiser.address);
    const uploader = await registerWithWallet();
    const admin = await registerWithWallet('ADMIN');

    const uploadResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/disputes/${chainDeliveryId.toString()}/evidence`,
      headers: { authorization: `Bearer ${uploader.accessToken}` },
      payload: {
        uploadedBy: uploader.address,
        contentType: 'image/png',
        base64Content: Buffer.from('other-party-evidence').toString('base64'),
      },
    });
    const evidenceId = uploadResponse.json<SuccessBody<{ evidenceId: string }>>().data.evidenceId;

    const raiserDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/evidence/${evidenceId}/download`,
      headers: { authorization: `Bearer ${raiser.accessToken}` },
    });
    expect(raiserDownload.statusCode).toBe(200);

    const adminDownload = await app.inject({
      method: 'GET',
      url: `/api/v1/disputes/evidence/${evidenceId}/download`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(adminDownload.statusCode).toBe(200);
  });

  it('rejects non-admin users from resolve-dispute-refund-sender endpoint with 403', async () => {
    const customer = await registerWithWallet('CUSTOMER');
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/resolve-dispute-refund-sender',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: {
        callerAddress: customer.address,
        chainDeliveryId: chainDeliveryId.toString(),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('rejects non-admin users from resolve-dispute-pay-driver endpoint with 403', async () => {
    const customer = await registerWithWallet('CUSTOMER');
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/resolve-dispute-pay-driver',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: {
        callerAddress: customer.address,
        chainDeliveryId: chainDeliveryId.toString(),
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('rejects non-admin users from resolve-dispute-split-funds endpoint with 403', async () => {
    const customer = await registerWithWallet('CUSTOMER');
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/resolve-dispute-split-funds',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: {
        callerAddress: customer.address,
        chainDeliveryId: chainDeliveryId.toString(),
        senderShareBps: 5000,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<ErrorBody>().error.code).toBe('FORBIDDEN');
  });

  it('allows admin users to access resolve-dispute-refund-sender endpoint', async () => {
    const admin = await registerWithWallet('ADMIN');
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/resolve-dispute-refund-sender',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        callerAddress: admin.address,
        chainDeliveryId: chainDeliveryId.toString(),
      },
    });

    expect([200, 502]).toContain(response.statusCode);
  });

  it('allows admin users to access resolve-dispute-pay-driver endpoint', async () => {
    const admin = await registerWithWallet('ADMIN');
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/resolve-dispute-pay-driver',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        callerAddress: admin.address,
        chainDeliveryId: chainDeliveryId.toString(),
      },
    });

    expect([200, 502]).toContain(response.statusCode);
  });

  it('allows admin users to access resolve-dispute-split-funds endpoint', async () => {
    const admin = await registerWithWallet('ADMIN');
    const chainDeliveryId = await seedDispute();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/resolve-dispute-split-funds',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        callerAddress: admin.address,
        chainDeliveryId: chainDeliveryId.toString(),
        senderShareBps: 5000,
      },
    });

    expect([200, 502]).toContain(response.statusCode);
  });

  it('allows non-admin users to access raise-dispute and add-evidence-hash endpoints', async () => {
    const customer = await registerWithWallet('CUSTOMER');
    const chainDeliveryId = await seedDispute();

    const raiseResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/raise-dispute',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: {
        callerAddress: customer.address,
        chainDeliveryId: chainDeliveryId.toString(),
      },
    });

    expect([200, 502]).toContain(raiseResponse.statusCode);

    const addEvidenceResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/add-evidence-hash',
      headers: { authorization: `Bearer ${customer.accessToken}` },
      payload: {
        callerAddress: customer.address,
        chainDeliveryId: chainDeliveryId.toString(),
        evidenceHash: 'a'.repeat(64),
      },
    });

    expect([200, 502]).toContain(addEvidenceResponse.statusCode);
  });
});
