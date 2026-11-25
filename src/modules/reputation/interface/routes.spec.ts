import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { createReputationRoutes, type ReputationUseCases } from './routes.js';
import { buildDriverProfile } from '../application/__fixtures__/fakes.js';
import type { DriverProfile } from '../domain/index.js';

/** Minimal stub set — only `getDriverProfile` is exercised by the
 * `GET /drivers/:address/reputation` route under test. */
function buildUseCases(profile: DriverProfile): ReputationUseCases {
  return {
    getDriverProfile: async () => profile,
    buildTransactions: {} as never,
  } as unknown as ReputationUseCases;
}

async function getReputationResponse(profile: DriverProfile) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createReputationRoutes(buildUseCases(profile)));
  const response = await app.inject({ method: 'GET', url: `/drivers/${profile.address}/reputation` });
  await app.close();
  return response;
}

describe('GET /drivers/:address/reputation serialization (#672)', () => {
  it('returns the complete DTO for a GOLD-tier profile', async () => {
    const profile = buildDriverProfile({
      tier: 'GOLD',
      reputationScore: 91,
      kycVerified: true,
      deliveriesCompleted: 120,
      legacyDeliveriesCompleted: 8,
      registeredAt: new Date('2026-02-01T00:00:00Z'),
    });

    const response = await getReputationResponse(profile);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      id: profile.id,
      address: profile.address,
      reputationScore: 91,
      tier: 'GOLD',
      kycVerified: true,
      deliveriesCompleted: 120,
      legacyDeliveriesCompleted: 8,
      registeredAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('retains zero count fields and a false kycVerified flag for a BRONZE-tier profile', async () => {
    const profile = buildDriverProfile({
      tier: 'BRONZE',
      reputationScore: 0,
      kycVerified: false,
      deliveriesCompleted: 0,
      legacyDeliveriesCompleted: 0,
      registeredAt: new Date('2026-01-15T12:30:00Z'),
    });

    const response = await getReputationResponse(profile);

    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    // Asserted field-by-field (not just toEqual) so a falsy-value drop
    // regresses loudly rather than silently matching `undefined`.
    expect(data.reputationScore).toBe(0);
    expect(data.deliveriesCompleted).toBe(0);
    expect(data.legacyDeliveriesCompleted).toBe(0);
    expect(data.kycVerified).toBe(false);
    expect(data.tier).toBe('BRONZE');
    expect(data.registeredAt).toBe('2026-01-15T12:30:00.000Z');
  });

  it('serializes a SILVER-tier profile with non-zero counts and kycVerified true', async () => {
    const profile = buildDriverProfile({
      tier: 'SILVER',
      reputationScore: 55,
      kycVerified: true,
      deliveriesCompleted: 4,
      legacyDeliveriesCompleted: 2,
      registeredAt: new Date('2026-03-10T00:00:00Z'),
    });

    const response = await getReputationResponse(profile);

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({
      id: profile.id,
      address: profile.address,
      reputationScore: 55,
      tier: 'SILVER',
      kycVerified: true,
      deliveriesCompleted: 4,
      legacyDeliveriesCompleted: 2,
      registeredAt: '2026-03-10T00:00:00.000Z',
    });
  });
});
