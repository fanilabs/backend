import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { envSchemaKeys, parseEnv } from './env.js';

/**
 * Every variable documented in .env.example should correspond to a schema
 * key (and vice versa) — otherwise either an operator is told to set a
 * variable that does nothing (see the SETTLEMENT_CONTRACT_ID removal this
 * test was added alongside), or the schema silently requires something
 * .env.example never mentions.
 */
function readEnvExampleKeys(): string[] {
  const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
  const contents = readFileSync(path, 'utf-8');
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line.split('=')[0]);
}

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

  it('keeps .env.example in sync with the schema (no undocumented or dead keys)', () => {
    const exampleKeys = readEnvExampleKeys().sort();
    expect(exampleKeys).toEqual([...envSchemaKeys].sort());
  });
});
