import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BODY_LIMIT } from '../../../shared/http/index.js';
import { createAuthRoutes } from './routes.js';

describe('auth routes bodyLimit enforcement (issue #460)', () => {
  function buildTestApp() {
    const app = Fastify({
      bodyLimit: DEFAULT_BODY_LIMIT,
    }).withTypeProvider<ZodTypeProvider>();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const mockUseCases = {
      registerUser: vi.fn(),
      login: vi.fn(),
      refreshSession: vi.fn(),
      logout: vi.fn(),
      verifyEmail: vi.fn(),
      requestPasswordReset: vi.fn(),
      resetPassword: vi.fn(),
    };

    void app.register(createAuthRoutes(mockUseCases as never));
    return { app, mockUseCases };
  }

  it('rejects oversized JSON payload (>256KB) with HTTP 413 Payload Too Large', async () => {
    const { app } = buildTestApp();
    const oversizedBody = JSON.stringify({
      email: 'test@example.com',
      password: 'p'.repeat(300 * 1024),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: oversizedBody,
    });

    expect(response.statusCode).toBe(413);
  });

  it('accepts standard-sized JSON payload (<=256KB) without HTTP 413', async () => {
    const { app, mockUseCases } = buildTestApp();
    mockUseCases.login.mockResolvedValue({
      accessToken: 'valid-jwt-access-token',
      refreshToken: 'valid-jwt-refresh-token',
      user: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'test@example.com',
        role: 'CUSTOMER',
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const normalBody = JSON.stringify({
      email: 'test@example.com',
      password: 'valid-password',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: normalBody,
    });

    expect(response.statusCode).toBe(200);
  });
});
