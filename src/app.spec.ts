import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('buildApp — not-found handler', () => {
  it('returns 404 with standard error envelope for an unknown path', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist-xyz' });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; message: string }; requestId: string }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toBe('Route not found');
    expect(typeof body.requestId).toBe('string');
  });

  it('returns 404 for a completely unknown top-level path', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/nonexistent' });
    expect(response.statusCode).toBe(404);
    const body = response.json<{ error: { code: string; message: string }; requestId: string }>();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('existing health route still returns 200', async () => {
    const app = await buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });
});
