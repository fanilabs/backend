import { PrismaClient } from '@prisma/client';

/**
 * Upper bound (in milliseconds) for the test database availability probe.
 *
 * Offline test collection must finish its availability check within this
 * documented bound so a stalled connection cannot delay collection before
 * any spec runs. A never-settling `SELECT 1` resolves the optional probe to
 * `false` once this deadline elapses.
 */
export const DATABASE_PROBE_TIMEOUT_MS = 2_000;

/**
 * Upper bound (in milliseconds) for tearing down the probe client.
 *
 * A stalled or rejecting `$disconnect` must not hang collection or surface
 * as an unhandled rejection; teardown is best-effort and bounded.
 */
export const DATABASE_PROBE_TEARDOWN_TIMEOUT_MS = 1_000;

/**
 * Minimal surface of the Prisma client used by the availability probe.
 * Injectable so tests can supply a fake client deterministically.
 */
export interface DatabaseProbeClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  $disconnect(): Promise<void>;
}

export interface DatabaseAvailabilityOptions {
  /** When true, an unavailable database resolves to `false` instead of throwing. */
  optional?: boolean;
  /** Injectable probe client; defaults to a fresh `PrismaClient`. */
  client?: DatabaseProbeClient;
  /** Override the probe deadline (defaults to `DATABASE_PROBE_TIMEOUT_MS`). */
  timeoutMs?: number;
  /** Override the teardown deadline (defaults to `DATABASE_PROBE_TEARDOWN_TIMEOUT_MS`). */
  teardownTimeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Database probe timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function disconnectProbe(
  client: DatabaseProbeClient,
  teardownTimeoutMs: number,
): Promise<void> {
  try {
    await withTimeout(Promise.resolve().then(() => client.$disconnect()), teardownTimeoutMs);
  } catch {
    // Teardown is best-effort: a stalled or rejecting disconnect must not
    // hang collection or produce an unhandled rejection.
  }
}

/**
 * Probe whether the test database is reachable.
 *
 * Resolves `true` when the probe succeeds (and disconnects the probe client),
 * and `false` in optional mode when the database is unavailable or the probe
 * exceeds its deadline. In required mode, failures are rethrown.
 */
export async function isDatabaseAvailable(
  options: DatabaseAvailabilityOptions = {},
): Promise<boolean> {
  const {
    optional = false,
    client,
    timeoutMs = DATABASE_PROBE_TIMEOUT_MS,
    teardownTimeoutMs = DATABASE_PROBE_TEARDOWN_TIMEOUT_MS,
  } = options;

  const probeClient: DatabaseProbeClient = client ?? (new PrismaClient() as unknown as DatabaseProbeClient);

  try {
    await withTimeout(probeClient.$queryRawUnsafe('SELECT 1'), timeoutMs);
    return true;
  } catch (error) {
    if (optional) {
      return false;
    }
    throw error;
  } finally {
    await disconnectProbe(probeClient, teardownTimeoutMs);
  }
}
