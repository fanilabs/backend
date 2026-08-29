import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { logger } from './shared/logger/index.js';
import { handleError } from './shared/errors/index.js';
import { getConfig } from './shared/config/index.js';
import {
  securityPlugin,
  docsPlugin,
  metricsPlugin,
  healthRoutes,
  createMetricsRoutes,
} from './shared/http/index.js';
import { indexerLagLedgers, queueJobsGauge } from './shared/metrics/index.js';
import { getQueueHealth } from './shared/queue/index.js';
import { getPrismaClient } from './shared/database/index.js';
import { createAuthModule } from './modules/auth/index.js';
import { createUsersModule } from './modules/users/index.js';
import { createIndexerHealthPlugin, getIndexerLagMetrics } from './modules/indexer/index.js';
import { createDeliveriesModule } from './modules/deliveries/index.js';
import { createEscrowModule } from './modules/escrow/index.js';
import { createFleetModule } from './modules/fleet/index.js';
import { createDisputesModule } from './modules/disputes/index.js';
import { createReputationModule } from './modules/reputation/index.js';
import { createNotificationsModule } from './modules/notifications/index.js';
import { createAnalyticsModule } from './modules/analytics/index.js';
import { createFraudDetectionModule } from './modules/fraud-detection/index.js';
import { createAdminModule } from './modules/admin/index.js';

/**
 * Composes the Fastify instance with no side effects (no `listen()` call) so
 * it can be built once for the real server (src/server.ts) and again,
 * identically, inside API tests via `app.inject()`.
 *
 * Request logging volume is controlled by the shared logger's level (see
 * src/shared/logger/index.ts — silent by default in `test`), not by a
 * per-instance Fastify flag.
 *
 * Module route registration is added here incrementally as each module
 * ships in Phase 5 — see ROADMAP.md §5 for what's left.
 */
export async function buildApp() {
  const config = getConfig();
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: config.EVIDENCE_MAX_BYTES,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);

  const prisma = getPrismaClient();

  await app.register(securityPlugin);
  await app.register(docsPlugin);
  await app.register(metricsPlugin);
  await app.register(healthRoutes);
  await app.register(
    createMetricsRoutes({
      refreshExternalGauges: async () => {
        const [contracts, queues] = await Promise.all([
          getIndexerLagMetrics(prisma),
          getQueueHealth(),
        ]);
        for (const contract of contracts) {
          if (contract.lagLedgers !== null) {
            indexerLagLedgers.set({ contract: contract.contractName }, contract.lagLedgers);
          }
        }
        for (const queue of queues) {
          queueJobsGauge.set({ queue: queue.name, state: 'waiting' }, queue.waiting);
          queueJobsGauge.set({ queue: queue.name, state: 'active' }, queue.active);
          queueJobsGauge.set({ queue: queue.name, state: 'delayed' }, queue.delayed);
          queueJobsGauge.set({ queue: queue.name, state: 'failed' }, queue.failed);
          queueJobsGauge.set({ queue: queue.name, state: 'completed' }, queue.completed);
        }
      },
    }),
  );

  await app.register(createAuthModule(prisma), { prefix: '/api/v1' });
  await app.register(createUsersModule(prisma), { prefix: '/api/v1' });
  await app.register(createIndexerHealthPlugin(prisma));
  await app.register(createDeliveriesModule(prisma), { prefix: '/api/v1' });
  await app.register(createEscrowModule(prisma), { prefix: '/api/v1' });
  await app.register(createFleetModule(prisma), { prefix: '/api/v1' });
  await app.register(createDisputesModule(prisma), { prefix: '/api/v1' });
  await app.register(createReputationModule(prisma), { prefix: '/api/v1' });
  await app.register(createNotificationsModule(prisma), { prefix: '/api/v1' });
  await app.register(createAnalyticsModule(prisma), { prefix: '/api/v1' });
  await app.register(createFraudDetectionModule(prisma), { prefix: '/api/v1' });
  await app.register(createAdminModule(prisma), { prefix: '/api/v1' });

  return app;
}
