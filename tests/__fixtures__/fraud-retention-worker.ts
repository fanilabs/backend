import { PrismaClient } from '@prisma/client';
import { createFraudActivityCleanupWorker } from '../../src/modules/fraud-detection/infrastructure/cleanup-queue.js';
import { disconnectQueueConnection } from '../../src/shared/queue/index.js';

// A fresh OS process, using the same production factory and disposable service
// environment as the parent integration test. No module mocks or fake Worker.
async function main() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test environment required');
  const prisma = new PrismaClient();
  const worker = createFraudActivityCleanupWorker(prisma);
  // Short fixture-only lock/stall intervals make crash recovery deterministic
  // without changing production retry/locking defaults.
  worker.opts.lockDuration = 500;
  worker.opts.stalledInterval = 500;
  if (process.env.RETENTION_TEST_CRASH_ON_ACTIVE === '1') {
    worker.once('active', () => process.kill(process.pid, 'SIGKILL'));
  }
  await worker.waitUntilReady();
  process.send?.('ready');
  process.once('message', () => {
    void (async () => {
      await worker.close();
      await disconnectQueueConnection();
      await prisma.$disconnect();
      process.disconnect();
    })().catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`);
      process.exitCode = 1;
    });
  });
}
void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
