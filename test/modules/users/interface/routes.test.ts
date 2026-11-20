import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const authenticateMock = vi.fn(async (request: any) => {
  request.user = { id: 'user-1' };
});

vi.mock('../../../../src/shared/http/plugins/auth-guard', () => ({
  authenticate: authenticateMock,
}));

import { createUsersRoutes } from '../../../../src/modules/users/interface/routes';

describe('users routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    authenticateMock.mockClear();
    app = Fastify();
    await app.register(createUsersRoutes, { prefix: '/api/v1' });
    await app.ready();
  });

  it('executes authenticate exactly once for GET /api/v1/users/me', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
    });

    expect(authenticateMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).not.toBe(401);
  });
});
