import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { getConfig } from './shared/config/index.js';
import { logger } from './shared/logger/index.js';
import { disconnectPrisma } from './shared/database/index.js';
import { disconnectRedis } from './shared/cache/index.js';
import { disconnectQueueConnection, closeAllQueues } from './shared/queue/index.js';

async function main(): Promise<void> {
  const config = getConfig();
  const app = await buildApp();

  closeWithGrace({ delay: 10_000 }, async ({ err }: { err?: Error }) => {
    // Everything below is best-effort teardown: each step is attempted even
    // if an earlier one throws (e.g. an already-disconnected Redis/Prisma),
    // and the aggregate failure is logged rather than left as an unhandled
    // rejection — otherwise a failure *inside* the handler would fail the
    // shutdown silently (#294).
    const shutdownErrors: unknown[] = [];

    try {
      if (err) {
        logger.error({ err }, 'Shutting down due to unhandled error');
      } else {
        logger.info('Shutting down gracefully');
      }
    } catch (logError: unknown) {
      shutdownErrors.push(logError);
    }

    for (const step of [
      () => app.close(),
      () => closeAllQueues(),
      () =>
        Promise.all([disconnectPrisma(), disconnectRedis(), disconnectQueueConnection()]).then(
          () => undefined,
        ),
    ]) {
      try {
        await step();
      } catch (stepError: unknown) {
        shutdownErrors.push(stepError);
      }
    }

    if (shutdownErrors.length > 0) {
      logger.error(
        { err: shutdownErrors[0], errors: shutdownErrors },
        'Errors during graceful shutdown',
      );
    }
  });

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  logger.error({ err: error }, 'Failed to start server');
  process.exit(1);
});
