import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const setupModulePath = resolve(here, 'env.ts');

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the setup module in an isolated child process with a controlled
 * environment dictionary. The child imports the module (optionally twice)
 * and reports only nonsecret verification flags as JSON on stdout.
 */
function runSetupInChild(
  env: Record<string, string>,
  imports = 1,
): ChildResult {
  const script = `
    const flags = {};
    const report = () => {
      process.stdout.write(JSON.stringify(flags));
    };
    const run = async () => {
      for (let i = 0; i < ${imports}; i += 1) {
        await import(${JSON.stringify(setupModulePath)});
      }
      flags.hasDatabaseUrl = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
      flags.hasRedisUrl = typeof process.env.REDIS_URL === 'string' && process.env.REDIS_URL.length > 0;
      flags.nodeEnv = process.env.NODE_ENV;
      flags.databaseUrlIsDefault = process.env.DATABASE_URL === 'postgresql://postgres:postgres@localhost:5432/test';
      flags.redisUrlIsDefault = process.env.REDIS_URL === 'redis://localhost:6379';
      flags.bigIntJson = typeof BigInt.prototype.toJSON === 'function';
      report();
    };
    run().catch((err) => {
      process.stderr.write(String(err && err.stack ? err.stack : err));
      process.exit(1);
    });
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseFlags(result: ChildResult): Record<string, unknown> {
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe('test environment bootstrap', () => {
  it('fills absent database and Redis settings with documented test defaults', () => {
    const flags = parseFlags(runSetupInChild({ NODE_ENV: 'test' }));

    expect(flags.hasDatabaseUrl).toBe(true);
    expect(flags.hasRedisUrl).toBe(true);
    expect(flags.databaseUrlIsDefault).toBe(true);
    expect(flags.redisUrlIsDefault).toBe(true);
    expect(flags.bigIntJson).toBe(true);
  });

  it('preserves explicit synthetic overrides including NODE_ENV', () => {
    const flags = parseFlags(
      runSetupInChild({
        NODE_ENV: 'synthetic-override',
        DATABASE_URL: 'postgresql://synthetic:secret@example.test:5432/synthetic',
        REDIS_URL: 'redis://example.test:6379',
      }),
    );

    expect(flags.nodeEnv).toBe('synthetic-override');
    expect(flags.databaseUrlIsDefault).toBe(false);
    expect(flags.redisUrlIsDefault).toBe(false);
    expect(flags.hasDatabaseUrl).toBe(true);
    expect(flags.hasRedisUrl).toBe(true);
  });

  it('does not replace existing values or fail on a second import', () => {
    const flags = parseFlags(
      runSetupInChild(
        {
          NODE_ENV: 'test',
          DATABASE_URL: 'postgresql://synthetic:secret@example.test:5432/synthetic',
          REDIS_URL: 'redis://example.test:6379',
        },
        2,
      ),
    );

    expect(flags.nodeEnv).toBe('test');
    expect(flags.databaseUrlIsDefault).toBe(false);
    expect(flags.redisUrlIsDefault).toBe(false);
  });
});
