import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://fanilab:fanilab@localhost:5432/fanilab_backend_test?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('parseEnv', () => {
  it('rejects an invalid LOG_LEVEL with the standard configuration error', () => {
    expect(() => parseEnv({ ...required, LOG_LEVEL: 'verbose' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('defaults LOG_LEVEL to silent when NODE_ENV is test and no level is set', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'test' });
    expect(env.LOG_LEVEL).toBe('silent');
  });

  it('respects an explicit LOG_LEVEL even when NODE_ENV is test', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'test', LOG_LEVEL: 'debug' });
    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('defaults LOG_LEVEL to info outside of test', () => {
    const env = parseEnv({ ...required, NODE_ENV: 'development' });
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('accepts extra unknown environment variables without failing', () => {
    expect(() => parseEnv({ ...required, SOME_UNRELATED_VAR: 'x' })).not.toThrow();
  });
});
