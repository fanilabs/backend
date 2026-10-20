import { describe, expect, it } from 'vitest';
import { healthStatusResponseSchema, queueHealthStatusResponseSchema } from './health.js';

describe('health route OpenAPI Zod schemas (#435)', () => {
  it('validates healthy and degraded /health payloads', () => {
    expect(healthStatusResponseSchema.safeParse({ status: 'ok', database: 'ok', redis: 'ok' }).success).toBe(true);
    expect(healthStatusResponseSchema.safeParse({ status: 'degraded', database: 'error', redis: 'ok' }).success).toBe(true);
  });

  it('validates /health/queue payloads', () => {
    expect(
      queueHealthStatusResponseSchema.safeParse({
        status: 'ok',
        queues: [{ name: 'notifications', waiting: 0, active: 0, completed: 5, failed: 0, delayed: 0, paused: 0 }],
      }).success,
    ).toBe(true);
  });
});
