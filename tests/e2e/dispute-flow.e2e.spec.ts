import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { disconnectPrisma } from '../../src/shared/database/index.js';
import { publishBlockchainEvent } from '../../src/shared/events/index.js';
import { isDatabaseAvailable } from '../../src/shared/testing/database.js';

/**
 * ROADMAP.md §10's second e2e suite: raise → upload evidence → download as
 * each authorised party → resolve. Unlike happy-path.e2e.spec.ts, dispute
 * sync (sync-dispute-from-event.ts) never makes a supplementary contract
 * read — both `dispute_raised` and the `dispute_resolved_*` events carry
 * everything the read model needs in their own payload — so this suite
 * needs no fixture-backed Soroban client, just fixture events and a real
 * Postgres + local evidence storage.
 */

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  { timeoutMs = 3000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before timeout');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe.skipIf(!dbAvailable)('dispute lifecycle (e2e)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdEmails: string[] = [];
  const chainDeliveryIds: bigint[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.walletAddress.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (chainDeliveryIds.length > 0) {
      await prisma.dispute.deleteMany({ where: { chainDeliveryId: { in: chainDeliveryIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  function nextChainDeliveryId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    chainDeliveryIds.push(id);
    return id;
  }

  async function registerLoginAndLinkWallet(): Promise<{ accessToken: string; address: string }> {
    const email = `e2e-dispute-${randomUUID()}@example.com`;
    const password = 'password123';
    createdEmails.push(email);

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password },
    });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    const { accessToken } = loginResponse.json<SuccessBody<{ accessToken: string }>>().data;
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;
    const signature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');
    await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature },
    });

    return { accessToken, address };
  }

  it(
    'drives raise → upload evidence → download as uploader → forbid an unrelated party → resolve',
    async () => {
      const raiser = await registerLoginAndLinkWallet();
      const outsider = await registerLoginAndLinkWallet();

      const chainDeliveryId = nextChainDeliveryId();
      const chainDeliveryIdStr = chainDeliveryId.toString();
      const adminAddress = Keypair.random().publicKey();

      // --- raise dispute (Layer B: dispute_resolution_contract) ---
      publishBlockchainEvent({
        contractName: 'dispute-resolution',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 2000n,
        txHash: 'tx-dispute-raised',
        topic: ['dispute_raised', JSON.stringify([chainDeliveryIdStr])],
        payload: [raiser.address],
        closedAt: new Date(),
      });

      const raisedDispute = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/disputes/${chainDeliveryIdStr}`,
        });
        if (response.statusCode !== 200) return undefined;
        return response.json<SuccessBody<{ status: string; raisedBy: string }>>().data;
      });
      expect(raisedDispute.status).toBe('OPEN');
      expect(raisedDispute.raisedBy).toBe(raiser.address);

      // --- upload evidence as the raiser ---
      const evidenceBytes = Buffer.from('e2e evidence fixture').toString('base64');
      const uploadResponse = await app.inject({
        method: 'POST',
        url: `/api/v1/disputes/${chainDeliveryIdStr}/evidence`,
        headers: { authorization: `Bearer ${raiser.accessToken}` },
        payload: {
          uploadedBy: raiser.address,
          contentType: 'image/png',
          base64Content: evidenceBytes,
        },
      });
      expect(uploadResponse.statusCode).toBe(200);
      const { evidenceId } = uploadResponse.json<SuccessBody<{ evidenceId: string }>>().data;

      // --- download as the uploader: authorised ---
      const downloadAsUploader = await app.inject({
        method: 'GET',
        url: `/api/v1/disputes/evidence/${evidenceId}/download`,
        headers: { authorization: `Bearer ${raiser.accessToken}` },
      });
      expect(downloadAsUploader.statusCode).toBe(200);

      // --- download as an unrelated party: forbidden ---
      const downloadAsOutsider = await app.inject({
        method: 'GET',
        url: `/api/v1/disputes/evidence/${evidenceId}/download`,
        headers: { authorization: `Bearer ${outsider.accessToken}` },
      });
      expect(downloadAsOutsider.statusCode).toBe(403);

      // --- resolve dispute ---
      publishBlockchainEvent({
        contractName: 'dispute-resolution',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 2001n,
        txHash: 'tx-dispute-resolved',
        topic: ['dispute_resolved_refund', JSON.stringify([chainDeliveryIdStr])],
        payload: [adminAddress],
        closedAt: new Date(),
      });

      const resolvedDispute = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/disputes/${chainDeliveryIdStr}`,
        });
        const body = response.json<SuccessBody<{ status: string; resolvedBy: string | null }>>()
          .data;
        return body.status === 'RESOLVED_REFUND' ? body : undefined;
      });
      expect(resolvedDispute.status).toBe('RESOLVED_REFUND');
      expect(resolvedDispute.resolvedBy).toBe(adminAddress);
    },
    15000,
  );
});
