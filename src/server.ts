import closeWithGrace from 'close-with-grace';
import { getConfig } from './shared/config/index.js';
import { logger } from './shared/logger/index.js';
import { disconnectPrisma } from './shared/database/index.js';
import { disconnectRedis } from './shared/cache/index.js';
import { disconnectQueueConnection, closeAllQueues } from './shared/queue/index.js';

export const BACKLOG = 511;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const DISCONNECT_TIMEOUT_MS = 3_000;

export async function withTimeout<T>(
  promiseFn: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} disconnect timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promiseFn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ShutdownStepsDeps {
  app: { close: () => Promise<unknown> };
  closeAllQueues: () => Promise<unknown>;
  disconnectPrisma: () => Promise<unknown>;
  disconnectRedis: () => Promise<unknown>;
  disconnectQueueConnection: () => Promise<unknown>;
  disconnectTimeoutMs?: number;
}

export async function executeShutdownSteps(deps: ShutdownStepsDeps): Promise<unknown[]> {
  const timeoutMs = deps.disconnectTimeoutMs ?? DISCONNECT_TIMEOUT_MS;
  const shutdownErrors: unknown[] = [];

  for (const step of [
    () => deps.app.close(),
    () => deps.closeAllQueues(),
    () => withTimeout(() => deps.disconnectPrisma(), timeoutMs, 'Prisma'),
    () => withTimeout(() => deps.disconnectRedis(), timeoutMs, 'Redis'),
    () => withTimeout(() => deps.disconnectQueueConnection(), timeoutMs, 'QueueConnection'),
  ]) {
    try {
      await step();
    } catch (stepError: unknown) {
      shutdownErrors.push(stepError);
    }
  }

  return shutdownErrors;
}

async function main(): Promise<void> {
  const config = getConfig();
  const { buildApp } = await import('./app.js');
  const app = await buildApp();

  closeWithGrace({ delay: SHUTDOWN_TIMEOUT_MS }, async ({ err }: { err?: Error }) => {
    // Everything below is best-effort teardown: each step is attempted sequentially
    // with individual timeouts even if an earlier one hangs or throws (e.g. an
    // unresponsive DB or an already-disconnected Redis/Prisma), and aggregate
    // failures are logged rather than left as unhandled rejections (#289, #294).
    const logErrors: unknown[] = [];

    try {
      if (err) {
        logger.error({ err }, 'Shutting down due to unhandled error');
      } else {
        logger.info('Shutting down gracefully');
      }
    } catch (logError: unknown) {
      logErrors.push(logError);
    }

    const shutdownErrors = await executeShutdownSteps({
      app,
      closeAllQueues,
      disconnectPrisma,
      disconnectRedis,
      disconnectQueueConnection,
    });

    const allErrors = [...logErrors, ...shutdownErrors];
    if (allErrors.length > 0) {
      logger.error({ err: allErrors[0], errors: allErrors }, 'Errors during graceful shutdown');
    }
  });

  await app.listen({ host: config.HOST, port: config.PORT, backlog: BACKLOG });
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((error: unknown) => {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  });
}
