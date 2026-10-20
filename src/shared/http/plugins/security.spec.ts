import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../cache/index.js', () => ({
  getRedisClient: vi.fn(() => undefined),
}));

import securityPlugin from './security.js';

describe('securityPlugin CORS exposedHeaders (#449)', () => {
  it('exposes RateLimit-* and Content-Disposition headers on cross-origin responses', async () => {
    const app = Fastify();
    await app.register(securityPlugin);
    app.get('/ping', async () => ({ ok: true }));

    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { origin: 'http://localhost:3000' },
    });

    expect(res.statusCode).toBe(200);
    const exposed = res.headers['access-control-expose-headers'];
    expect(String(exposed)).toContain('RateLimit-Remaining');
    expect(String(exposed)).toContain('Content-Disposition');
    await app.close();
  });
});
