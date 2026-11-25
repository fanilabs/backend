import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Mock the auth plugin so we can control authentication/authorization outcomes
// without depending on real token issuance.
vi.mock('../../src/modules/auth/interface/plugins/authenticate', () => ({
  authenticate: async (request: any, reply: any) => {
    const header = request.headers['authorization'];
    if (!header) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const role = request.headers['x-test-role'];
    request.user = { id: 'test-user', role: role ?? 'USER' };
  },
}));

vi.mock('../../src/modules/auth/interface/plugins/require-role', () => ({
  requireRole: (role: string) => async (request: any, reply: any) => {
    if (!request.user || request.user.role !== role) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
  },
}));

import { createFraudDetectionRoutes } from '../../src/modules/fraud-detection/interface/routes';

describe('fraud-detection routes auth lifecycle', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.decorateRequest('user', null);
    await app.register(createFraudDetectionRoutes, { prefix: '/fraud' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fraud/actors/0xabc',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for authenticated non-admin requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fraud/actors/0xabc',
      headers: { authorization: 'Bearer token', 'x-test-role': 'USER' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 for authenticated admin requests', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/fraud/actors/0xabc',
      headers: { authorization: 'Bearer token', 'x-test-role': 'ADMIN' },
    });
    expect(res.statusCode).toBe(200);
  });
});
