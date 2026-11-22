import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv, type Env } from './env.js';

let cachedConfig: Env | undefined;
let envFileLoaded = false;

/**
 * Explicitly load a host-run environment file into process.env before config
 * validation. Existing shell/process environment values take precedence: a
 * variable already present in process.env is never overwritten by the file.
 *
 * This is only for host-run development (e.g. `pnpm dev`). Docker Compose
 * `env_file` handling is separate and unaffected.
 *
 * Returns true when a file was loaded, false when no file was found.
 */
export function loadEnvFile(path = '.env'): boolean {
  if (envFileLoaded) return true;
  const filePath = resolve(process.cwd(), path);
  if (!existsSync(filePath)) return false;
  // Node's built-in env-file loader (no dependency). It does not override
  // variables already set in the shell, matching the documented precedence.
  process.loadEnvFile(filePath);
  envFileLoaded = true;
  return true;
}

/**
 * Lazily parsed, memoized application config. Lazy so that test suites can
 * set process.env before first access instead of racing module import order.
 *
 * When `loadEnvFile` is enabled (host-run development), the env file is read
 * before validation so values stored only in the file reach the process.
 */
export function getConfig(options: { loadEnvFile?: boolean } = {}): Env {
  if (options.loadEnvFile) loadEnvFile();
  cachedConfig ??= parseEnv();
  return cachedConfig;
}

export type { Env } from './env.js';
