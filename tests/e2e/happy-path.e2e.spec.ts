import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDatabaseAvailable } from '../../src/shared/testing/database.js';

/**
 * ROADMAP.md §10's core-loop e2e suite: register → verify email → login →
 * link wallet → create delivery → fund escrow → confirm → verify
 * reputation/notification effects — driven end to end against a real
 * Postgres, exactly like the module-level *.integration.spec.ts suites,
 * but crossing every module boundary in one flow instead of exercising
 * one module against its own fakes.
 *
 * The chain side is driven the way #80/this issue's proposed scope
 * describes: fixture events published straight through
 * `publishBlockchainEvent`, with each module's real Soroban contract-read
 * client (`getDelivery`/`getEscrow`/`getDriverProfile` — used to hydrate a
 * read model beyond what an event payload alone carries) swapped for an
 * in-memory fixture double. There is no FaniLab contract deployed for this
 * repo's own CI to call (see shared/testing/soroban.ts), so without this
 * swap `delivery_created`/`escrow_funded`/`reputation_increased` would all
 * fail their hydration read — this keeps the suite deterministic and
 * network-free rather than skipped outright.
 */

const deliveryFixtures = vi.hoisted(() => new Map<string, unknown>());
const escrowFixtures = vi.hoisted(() => new Map<string, unknown>());
const driverProfileFixtures = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../src/modules/deliveries/infrastructure/soroban-delivery-contract-client.js', () => ({
  createSorobanDeliveryContractClient: () => ({
    getDelivery: async (chainDeliveryId: bigint) => {
      const record = deliveryFixtures.get(chainDeliveryId.toString());
      if (!record) throw new Error(`No delivery fixture registered for ${chainDeliveryId}`);
      return record;
    },
    buildCreateDelivery: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildAssignDriver: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildMarkInTransit: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildConfirmDelivery: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildCancelDelivery: () => {
      throw new Error('not fixture-backed in this suite');
    },
  }),
}));

vi.mock('../../src/modules/escrow/infrastructure/soroban-escrow-contract-client.js', () => ({
  createSorobanEscrowContractClient: () => ({
    getEscrow: async (chainDeliveryId: bigint) => {
      const record = escrowFixtures.get(chainDeliveryId.toString());
      if (!record) throw new Error(`No escrow fixture registered for ${chainDeliveryId}`);
      return record;
    },
    buildCreateEscrow: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildReleaseEscrow: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildRefundEscrow: () => {
      throw new Error('not fixture-backed in this suite');
    },
  }),
}));

vi.mock('../../src/modules/reputation/infrastructure/soroban-reputation-contract-client.js', () => ({
  createSorobanReputationContractClient: () => ({
    getDriverProfile: async (address: string) => {
      const record = driverProfileFixtures.get(address);
      if (!record) throw new Error(`No driver profile fixture registered for ${address}`);
      return record;
    },
    buildRegisterDriver: () => {
      throw new Error('not fixture-backed in this suite');
    },
    buildUpdateDriverKycStatus: () => {
      throw new Error('not fixture-backed in this suite');
    },
  }),
}));

// Real config for everything else — only the three contract ids are forced
// on, so each module's composition root wires the fixture-backed client
// above instead of `createUnconfiguredContractClient`'s fail-loud stub.
vi.mock('../../src/shared/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/shared/config/index.js')>();
  return {
    ...actual,
    getConfig: () => ({
      ...actual.getConfig(),
      DELIVERY_CONTRACT_ID: 'CDELIVERYFIXTURE0000000000000000000000000000000000000000',
      ESCROW_CONTRACT_ID: 'CESCROWFIXTURE00000000000000000000000000000000000000000',
      IDENTITY_REPUTATION_CONTRACT_ID: 'CREPUTATIONFIXTURE00000000000000000000000000000000000',
    }),
  };
});

const { buildApp } = await import('../../src/app.js');
const { disconnectPrisma } = await import('../../src/shared/database/index.js');
const { publishBlockchainEvent } = await import('../../src/shared/events/index.js');
const { createJwtTokenService } = await import(
  '../../src/modules/auth/infrastructure/jwt-token-service.js'
);

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}

/** Blockchain event handlers run fire-and-forget off `publishBlockchainEvent`
 * (every module's infrastructure/event-subscription.ts), so the read model
 * they write to is only *eventually* consistent with a publish — this polls
 * the API itself, the observable contract this suite is meant to assert
 * against, rather than reaching into internals to know when a handler ran. */
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

describe.skipIf(!dbAvailable)('core delivery lifecycle (e2e)', () => {
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
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.walletAddress.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    if (chainDeliveryIds.length > 0) {
      await prisma.escrow.deleteMany({ where: { chainDeliveryId: { in: chainDeliveryIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: chainDeliveryIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  function nextChainDeliveryId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    chainDeliveryIds.push(id);
    return id;
  }

  /** register → verify email → login, the first three steps of the
   * roadmap's documented flow. Verification is driven with a token minted
   * by the same JwtTokenService the app itself uses (jwt-token-service.spec.ts
   * exercises this exact issue/verify round trip) rather than a fixture
   * mailer, since the wired `logger-mailer.ts` only logs the token. */
  async function registerVerifyAndLogin(): Promise<{ userId: string; accessToken: string }> {
    const email = `e2e-${randomUUID()}@example.com`;
    const password = 'password123';
    createdEmails.push(email);

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password },
    });
    expect(registerResponse.statusCode).toBe(201);
    const { userId } = registerResponse.json<SuccessBody<{ userId: string }>>().data;

    const tokenService = createJwtTokenService();
    const verificationToken = tokenService.issueEmailVerificationToken({
      id: userId,
      email,
      passwordHash: 'unused-in-this-suite',
      role: 'CUSTOMER',
      emailVerifiedAt: null,
      createdAt: new Date(),
    });
    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: verificationToken },
    });
    expect(verifyResponse.statusCode).toBe(200);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const { accessToken, user } = loginResponse.json<
      SuccessBody<{ accessToken: string; user: { emailVerifiedAt: string | null } }>
    >().data;
    expect(user.emailVerifiedAt).not.toBeNull();

    return { userId, accessToken };
  }

  async function linkWallet(accessToken: string): Promise<string> {
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    expect(challengeResponse.statusCode).toBe(200);
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;
    const signature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature },
    });
    expect(confirmResponse.statusCode).toBe(200);

    return address;
  }

  it(
    'drives register → link wallet → create delivery → fund escrow → confirm → reputation/notification',
    async () => {
      const sender = await registerVerifyAndLogin();
      const senderAddress = await linkWallet(sender.accessToken);

      const driver = await registerVerifyAndLogin();
      const driverAddress = await linkWallet(driver.accessToken);

      const recipientAddress = Keypair.random().publicKey();
      const chainDeliveryId = nextChainDeliveryId();
      const chainDeliveryIdStr = chainDeliveryId.toString();

      // --- create delivery ---
      deliveryFixtures.set(chainDeliveryIdStr, {
        chainDeliveryId,
        senderAddress,
        recipientAddress,
        driverAddress: null,
        status: 'PENDING',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
        transitStartedAt: null,
        deliveredAt: null,
      });
      publishBlockchainEvent({
        contractName: 'delivery',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 1000n,
        txHash: 'tx-delivery-created',
        topic: ['delivery_created'],
        payload: [chainDeliveryIdStr, senderAddress],
        closedAt: new Date(),
      });

      const createdDelivery = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/deliveries/${chainDeliveryIdStr}`,
        });
        if (response.statusCode !== 200) return undefined;
        return response.json<SuccessBody<{ status: string; senderAddress: string }>>().data;
      });
      expect(createdDelivery.status).toBe('PENDING');
      expect(createdDelivery.senderAddress).toBe(senderAddress);

      // --- fund escrow ---
      escrowFixtures.set(chainDeliveryIdStr, {
        chainDeliveryId,
        senderAddress,
        recipientAddress,
        driverAddress,
        token: 'CTOKENFIXTURE000000000000000000000000000000000000000000',
        amount: 1_000_000n,
        status: 'LOCKED',
        disputedBy: null,
        disputedAt: null,
        createdAtChain: new Date(),
      });
      publishBlockchainEvent({
        contractName: 'escrow',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 1001n,
        txHash: 'tx-escrow-funded',
        topic: ['escrow_funded', chainDeliveryIdStr],
        payload: [senderAddress, recipientAddress, '1000000'],
        closedAt: new Date(),
      });

      const fundedEscrow = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/escrow/${chainDeliveryIdStr}`,
        });
        if (response.statusCode !== 200) return undefined;
        return response.json<SuccessBody<{ status: string; driverAddress: string }>>().data;
      });
      expect(fundedEscrow.status).toBe('LOCKED');
      expect(fundedEscrow.driverAddress).toBe(driverAddress);

      // --- confirm delivery ---
      publishBlockchainEvent({
        contractName: 'delivery',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 1002n,
        txHash: 'tx-delivery-confirmed',
        topic: ['delivery_confirmed'],
        payload: [chainDeliveryIdStr],
        closedAt: new Date(),
      });

      const confirmedDelivery = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/deliveries/${chainDeliveryIdStr}`,
        });
        const body = response.json<SuccessBody<{ status: string }>>().data;
        return body.status === 'DELIVERED' ? body : undefined;
      });
      expect(confirmedDelivery.status).toBe('DELIVERED');

      // --- release escrow ---
      publishBlockchainEvent({
        contractName: 'escrow',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 1003n,
        txHash: 'tx-escrow-released',
        topic: ['escrow_released', chainDeliveryIdStr],
        payload: [driverAddress, '950000', '50000'],
        closedAt: new Date(),
      });

      const releasedEscrow = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/escrow/${chainDeliveryIdStr}`,
        });
        const body = response.json<SuccessBody<{ status: string; platformFee: string | null }>>()
          .data;
        return body.status === 'RELEASED' ? body : undefined;
      });
      expect(releasedEscrow.status).toBe('RELEASED');
      expect(releasedEscrow.platformFee).toBe('50000');

      // --- verify reputation updated (identity-reputation contract) ---
      driverProfileFixtures.set(driverAddress, {
        address: driverAddress,
        reputationScore: 55,
        kycVerified: true,
        deliveriesCompleted: 1,
        registeredAt: new Date(),
      });
      publishBlockchainEvent({
        contractName: 'identity-reputation',
        network: 'testnet',
        rpcEventId: randomUUID(),
        ledgerSeq: 1004n,
        txHash: 'tx-reputation-increased',
        topic: ['reputation_increased'],
        payload: [driverAddress, '5'],
        closedAt: new Date(),
      });

      const driverProfile = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/drivers/${driverAddress}/reputation`,
        });
        if (response.statusCode !== 200) return undefined;
        return response.json<SuccessBody<{ reputationScore: number; tier: string }>>().data;
      });
      expect(driverProfile.reputationScore).toBe(55);
      expect(driverProfile.tier).toBe('SILVER');

      // --- verify notification effects (driver notified of escrow_released) ---
      const notifications = await waitFor(async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/notifications',
          headers: { authorization: `Bearer ${driver.accessToken}` },
        });
        const body = response.json<SuccessBody<Array<{ type: string }>>>().data;
        return body.some((n) => n.type === 'escrow.escrow_released') ? body : undefined;
      });
      expect(notifications.some((n) => n.type === 'escrow.escrow_released')).toBe(true);
    },
    15000,
  );
});
