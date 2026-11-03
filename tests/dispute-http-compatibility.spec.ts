import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DisputeStatus, UserRole, PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { handleError } from '../src/shared/errors/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

import { ftyp24, extendedFtyp32, invalidMp4Headers } from './__fixtures__/mp4-headers.js';
import { createLocalEvidenceStorage } from '../src/modules/disputes/infrastructure/local-evidence-storage.js';
import { getConfig } from '../src/shared/config/index.js';

// Real module, Prisma repositories, authentication, schema compilers and local storage.
// The unconfigured chain client cannot submit transactions or make RPC calls.
const prisma = new PrismaClient();
const app = Fastify();
const ids: string[] = [];
const chainId = BigInt(Date.now());
const address = testAddress('http-uploader');
let baseDir: string;
let disputeId: string;
let evidenceId: string;
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const users = new Map<string, { id: string; token: string }>();
function headers(key: string) {
  const user = users.get(key);
  if (!user) throw new Error(`Missing fixture ${key}`);
  return { authorization: `Bearer ${user.token}` };
}
function userId(key: string) {
  const user = users.get(key);
  if (!user) throw new Error(`Missing fixture ${key}`);
  return user.id;
}
beforeAll(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'dispute-http-'));
  vi.stubEnv('EVIDENCE_STORAGE_DIR', baseDir);
  vi.stubEnv('DISPUTE_RESOLUTION_CONTRACT_ID', '');
  vi.stubEnv('ESCROW_CONTRACT_ID', '');
  const { createDisputesModule } = await import('../src/modules/disputes/index.js');
  for (const role of Object.values(UserRole)) {
    for (const subject of ['raiser', 'uploader', 'stranger']) {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@dispute.invalid`,
          passwordHash: 'fixture-only',
          role,
        },
      });
      ids.push(user.id);
      users.set(`${role}-${subject}`, {
        id: user.id,
        token: signAccessToken({ sub: user.id, role, tokenVersion: 0 }),
      });
    }
  }
  await prisma.walletAddress.create({
    data: { userId: userId('CUSTOMER-uploader'), address, verifiedAt: new Date() },
  });
  await prisma.delivery.create({
    data: {
      chainDeliveryId: chainId,
      senderAddress: address,
      recipientAddress: testAddress('http-recipient'),
      status: 'DISPUTED',
      origin: 'A',
      destination: 'B',
      cargoCategory: 'GENERAL',
      weightGrams: 500,
      fragile: false,
      createdAtChain: new Date(),
    },
  });
  const dispute = await prisma.dispute.create({
    data: {
      chainDeliveryId: chainId,
      status: 'OPEN',
      raisedBy: testAddress('http-raiser'),
      raisedAt: new Date(),
      raisedByUserId: userId('CUSTOMER-raiser'),
    },
  });
  disputeId = dispute.id;
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(createDisputesModule(prisma));
  const upload = await app.inject({
    method: 'POST',
    url: `/disputes/${chainId}/evidence`,
    headers: headers('CUSTOMER-uploader'),
    payload: {
      uploadedBy: address,
      contentType: 'image/png',
      base64Content: bytes.toString('base64'),
    },
  });
  expect(upload.statusCode).toBe(200);
  evidenceId = upload.json().data.evidenceId;
});
afterAll(async () => {
  await app.close();
  await prisma.evidence.deleteMany({ where: { disputeId } });
  await prisma.dispute.deleteMany({ where: { chainDeliveryId: chainId } });
  await prisma.delivery.deleteMany({ where: { chainDeliveryId: chainId } });
  await prisma.walletAddress.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
  await disconnectPrisma();
  vi.unstubAllEnvs();
  if (baseDir) await rm(baseDir, { recursive: true, force: true });
});
describe('dispute HTTP compatibility', () => {
  for (const status of Object.values(DisputeStatus)) {
    for (const role of Object.values(UserRole)) {
      for (const subject of ['raiser', 'uploader', 'stranger']) {
        it(`${status} / ${role} / ${subject} preserves download policy`, async () => {
          const key = `${role}-${subject}`;
          await prisma.dispute.update({
            where: { id: disputeId },
            data: {
              status,
              raisedByUserId: subject === 'raiser' ? userId(key) : userId('CUSTOMER-raiser'),
            },
          });
          await prisma.evidence.update({
            where: { id: evidenceId },
            data: {
              uploadedByUserId: subject === 'uploader' ? userId(key) : userId('CUSTOMER-uploader'),
            },
          });
          const response = await app.inject({
            method: 'GET',
            url: `/disputes/evidence/${evidenceId}/download`,
            headers: headers(key),
          });
          const allowed = role === 'ADMIN' || (status === 'OPEN' && subject !== 'stranger');
          expect(response.statusCode).toBe(allowed ? 200 : 403);
          if (allowed) {
            expect(response.rawPayload).toEqual(bytes);
            expect(response.headers['content-type']).toBe('image/png');
            expect(response.headers['content-disposition']).toBe(
              `attachment; filename="${evidenceId}.png"`,
            );
          } else expect(response.json().error.code).toBe('FORBIDDEN');
        });
      }
    }
  }
  it('retains legacy uploader fallback and prevents stable uploader relink access', async () => {
    await prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'OPEN', raisedByUserId: null },
    });
    await prisma.evidence.update({ where: { id: evidenceId }, data: { uploadedByUserId: null } });
    const download = () =>
      app.inject({
        method: 'GET',
        url: `/disputes/evidence/${evidenceId}/download`,
        headers: headers('CUSTOMER-uploader'),
      });
    expect((await download()).statusCode).toBe(200);
    await prisma.evidence.update({
      where: { id: evidenceId },
      data: { uploadedByUserId: userId('CUSTOMER-raiser') },
    });
    expect((await download()).statusCode).toBe(403);
  });
  it('enforces authentication, UUID schema, missing evidence and upload validation', async () => {
    const url = `/disputes/evidence/${evidenceId}/download`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          url: '/disputes/evidence/invalid/download',
          headers: headers('ADMIN-stranger'),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: `/disputes/evidence/${randomUUID()}/download`,
          headers: headers('ADMIN-stranger'),
        })
      ).statusCode,
    ).toBe(404);
    for (const status of Object.values(DisputeStatus)) {
      await prisma.dispute.update({ where: { id: disputeId }, data: { status } });
      const response = await app.inject({
        method: 'POST',
        url: `/disputes/${chainId}/evidence`,
        headers: headers('CUSTOMER-uploader'),
        payload: {
          uploadedBy: address,
          contentType: 'image/png',
          base64Content: Buffer.from('invalid PNG').toString('base64'),
        },
      });
      expect(response.statusCode).toBe(status === 'OPEN' ? 400 : 409);
    }
    expect(await prisma.evidence.count({ where: { disputeId } })).toBe(1);
  });
  it('preserves uploader ownership and ADMIN-only split schema bounds over HTTP', async () => {
    await prisma.dispute.update({ where: { id: disputeId }, data: { status: 'OPEN' } });
    const upload = await app.inject({
      method: 'POST',
      url: `/disputes/${chainId}/evidence`,
      headers: headers('CUSTOMER-stranger'),
      payload: {
        uploadedBy: address,
        contentType: 'image/png',
        base64Content: bytes.toString('base64'),
      },
    });
    expect(upload.statusCode).toBe(403);
    const payload = {
      callerAddress: address,
      chainDeliveryId: chainId.toString(),
      senderShareBps: 5000,
    };
    const url = '/transactions/build/resolve-dispute-split-funds';
    expect(
      (await app.inject({ method: 'POST', url, headers: headers('CUSTOMER-uploader'), payload }))
        .statusCode,
    ).toBe(403);
    for (const senderShareBps of [-1, 10001, 1.5]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url,
            headers: headers('ADMIN-stranger'),
            payload: { ...payload, senderShareBps },
          })
        ).statusCode,
      ).toBe(400);
    }
    // A valid ADMIN request reaches the deliberately unconfigured builder; no RPC is possible.
    expect(
      (await app.inject({ method: 'POST', url, headers: headers('ADMIN-stranger'), payload }))
        .statusCode,
    ).toBe(502);
    expect(await prisma.evidence.count({ where: { disputeId } })).toBe(1);
  });
  it('does not transfer stable historical download rights when a wallet is relinked', async () => {
    await prisma.dispute.update({
      where: { id: disputeId },
      data: { status: 'OPEN', raisedBy: address, raisedByUserId: userId('CUSTOMER-raiser') },
    });
    await prisma.evidence.update({
      where: { id: evidenceId },
      data: { uploadedByUserId: userId('CUSTOMER-uploader') },
    });
    await prisma.walletAddress.update({
      where: { address },
      data: { userId: userId('CUSTOMER-stranger') },
    });
    for (const [subject, expected] of [
      ['stranger', 403],
      ['raiser', 200],
      ['uploader', 200],
    ] as const) {
      const response = await app.inject({
        url: `/disputes/evidence/${evidenceId}/download`,
        headers: headers(`CUSTOMER-${subject}`),
      });
      expect(response.statusCode).toBe(expected);
    }
  });
  it.each([ftyp24, extendedFtyp32])(
    'uploads an owned MP4 header and preserves hash, identity and bytes',
    async (mp4) => {
      await prisma.dispute.update({ where: { id: disputeId }, data: { status: 'OPEN' } });
      await prisma.walletAddress.update({
        where: { address },
        data: { userId: userId('CUSTOMER-uploader') },
      });
      const response = await app.inject({
        method: 'POST',
        url: `/disputes/${chainId}/evidence`,
        headers: headers('CUSTOMER-uploader'),
        payload: {
          uploadedBy: address,
          contentType: 'video/mp4',
          base64Content: mp4.toString('base64'),
        },
      });
      expect(response.statusCode).toBe(200);
      const stored = await prisma.evidence.findUniqueOrThrow({
        where: { id: response.json<{ data: { evidenceId: string } }>().data.evidenceId },
      });
      const storage = createLocalEvidenceStorage(baseDir);
      try {
        expect(stored.uploadedByUserId).toBe(userId('CUSTOMER-uploader'));
        expect(stored.hash).toBe(createHash('sha256').update(mp4).digest('hex'));
        expect(response.json<{ data: { hash: string } }>().data.hash).toBe(stored.hash);
        expect(await storage.read(stored.storageUrl)).toEqual(mp4);
      } finally {
        await prisma.evidence.delete({ where: { id: stored.id } });
        await storage.delete(stored.storageUrl);
      }
    },
  );

  it.each(invalidMp4Headers)(
    'returns400 for $name without writing evidence',
    async ({ bytes: invalid }) => {
      const before = await prisma.evidence.count({ where: { disputeId } });
      const files = await readdir(join(baseDir, disputeId));
      const response = await app.inject({
        method: 'POST',
        url: `/disputes/${chainId}/evidence`,
        headers: headers('CUSTOMER-uploader'),
        payload: {
          uploadedBy: address,
          contentType: 'video/mp4',
          base64Content: invalid.toString('base64'),
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.evidence.count({ where: { disputeId } })).toBe(before);
      expect(await readdir(join(baseDir, disputeId))).toEqual(files);
    },
  );

  it('preserves401/403/409/404 and upload size errors for MP4', async () => {
    const url = `/disputes/${chainId}/evidence`;
    const payload = {
      uploadedBy: address,
      contentType: 'video/mp4',
      base64Content: ftyp24.toString('base64'),
    };
    expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url, headers: headers('CUSTOMER-stranger'), payload }))
        .statusCode,
    ).toBe(403);
    await prisma.dispute.update({ where: { id: disputeId }, data: { status: 'RESOLVED_REFUND' } });
    expect(
      (await app.inject({ method: 'POST', url, headers: headers('CUSTOMER-uploader'), payload }))
        .statusCode,
    ).toBe(409);
    await prisma.dispute.update({ where: { id: disputeId }, data: { status: 'OPEN' } });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/disputes/${chainId + 999n}/evidence`,
          headers: headers('CUSTOMER-uploader'),
          payload,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: headers('CUSTOMER-uploader'),
          payload: { ...payload, contentType: 'video/not-mp4' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers: headers('CUSTOMER-uploader'),
          payload: { ...payload, contentType: 'image/png' },
        })
      ).statusCode,
    ).toBe(400);
    const oversized = Buffer.concat([ftyp24, Buffer.alloc(getConfig().EVIDENCE_MAX_BYTES + 1)]);
    const sizeResponse = await app.inject({
      method: 'POST',
      url,
      headers: headers('CUSTOMER-uploader'),
      payload: { ...payload, base64Content: oversized.toString('base64') },
    });
    expect(sizeResponse.statusCode).toBe(400);
    expect(sizeResponse.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
    const bodyResponse = await app.inject({
      method: 'POST',
      url,
      headers: headers('CUSTOMER-uploader'),
      payload: { ...payload, base64Content: 'A'.repeat(16 * 1024 * 1024) },
    });
    expect(bodyResponse.statusCode).toBe(413);
  });
});
