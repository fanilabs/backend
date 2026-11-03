import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFraudDetectionModule } from '../src/modules/fraud-detection/index.js';
import { RULES } from '../src/modules/fraud-detection/application/assess-actor.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { handleError } from '../src/shared/errors/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';

const prisma = new PrismaClient();
const app = Fastify();
const users: string[] = [];
const address = testAddress('fraud-root-http');
const other = testAddress('fraud-root-other');
let adminToken: string;
let customerToken: string;

beforeAll(async () => {
  for (const role of ['ADMIN', 'CUSTOMER'] as const) {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@fraud-root.invalid`, passwordHash: 'fixture-only', role },
    });
    users.push(user.id);
    const token = signAccessToken({ sub: user.id, role: 'ADMIN', tokenVersion: 0 });
    if (role === 'ADMIN') adminToken = token;
    else customerToken = token;
  }
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  await app.register(createFraudDetectionModule(prisma));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.actorActivity.deleteMany({ where: { address: { in: [address, other] } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  await disconnectPrisma();
});

describe('actual fraud root HTTP composition', () => {
  const url = `/fraud-detection/actors/${address}`;
  it('requires authentication', async () => {
    expect((await app.inject({ url })).statusCode).toBe(401);
  });

  it('requires the primary-database ADMIN role despite an ADMIN token claim', async () => {
    expect(
      (await app.inject({ url, headers: { authorization: `Bearer ${customerToken}` } })).statusCode,
    ).toBe(403);
  });

  it('preserves address validation', async () => {
    expect(
      (
        await app.inject({
          url: '/fraud-detection/actors/invalid',
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('uses the canonical rule names/default thresholds/hour windows without activity writes', async () => {
    const before = await prisma.actorActivity.count();
    const response = await app.inject({ url, headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      address,
      flagged: false,
      signals: RULES.map((rule) => ({ ...rule, count: 0, triggered: false })),
    });
    expect(await prisma.actorActivity.count()).toBe(before);
  });

  it('assesses persisted actor activity with strict threshold and actor isolation', async () => {
    const occurredAt = new Date();
    await prisma.actorActivity.createMany({
      data: [address, other].flatMap((actor) =>
        Array.from({ length: 11 }, () => ({
          address: actor,
          category: 'DELIVERY_CREATED' as const,
          occurredAt,
        })),
      ),
    });
    const response = await app.inject({ url, headers: { authorization: `Bearer ${adminToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      address,
      flagged: true,
      signals: RULES.map((rule) => ({
        ...rule,
        count: rule.category === 'DELIVERY_CREATED' ? 11 : 0,
        triggered: rule.category === 'DELIVERY_CREATED',
      })),
    });
  });
});
