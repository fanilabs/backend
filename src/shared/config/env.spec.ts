import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('CORS_ORIGIN validation', () => {
  it('defaults to a single localhost origin, parsed into an array', () => {
    const env = parseEnv(baseEnv());
    expect(env.CORS_ORIGIN).toEqual(['http://localhost:3000']);
  });

  it('parses a comma-separated list, trimming whitespace', () => {
    const env = parseEnv(baseEnv({ CORS_ORIGIN: ' https://a.example , https://b.example ' }));
    expect(env.CORS_ORIGIN).toEqual(['https://a.example', 'https://b.example']);
  });

  it('drops empty segments from trailing/double commas rather than keeping them', () => {
    const env = parseEnv(baseEnv({ CORS_ORIGIN: 'https://a.example,,' }));
    expect(env.CORS_ORIGIN).toEqual(['https://a.example']);
  });

  it('rejects an origin with a path', () => {
    expect(() => parseEnv(baseEnv({ CORS_ORIGIN: 'https://a.example/some/path' }))).toThrow();
  });

  it('rejects an origin with a trailing slash', () => {
    expect(() => parseEnv(baseEnv({ CORS_ORIGIN: 'https://a.example/' }))).toThrow();
  });

  it('rejects a malformed origin', () => {
    expect(() => parseEnv(baseEnv({ CORS_ORIGIN: 'not-a-url' }))).toThrow();
  });

  it('rejects a wildcard origin', () => {
    expect(() => parseEnv(baseEnv({ CORS_ORIGIN: '*' }))).toThrow();
  });

  it('rejects a wildcard mixed into a valid list', () => {
    expect(() => parseEnv(baseEnv({ CORS_ORIGIN: 'https://a.example,*' }))).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => parseEnv(baseEnv({ CORS_ORIGIN: '' }))).toThrow();
  });

  it('accepts a valid multi-origin list including a non-default port', () => {
    const env = parseEnv(
      baseEnv({ CORS_ORIGIN: 'https://app.example.com,http://localhost:5173' }),
    );
    expect(env.CORS_ORIGIN).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });
});
