import './shared/serialization/bigint.js';
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
 * Default request body limit for the whole API surface. Standard JSON
 * endpoints (auth, users, etc.) never need more than this, and keeping it
 * small prevents unauthenticated clients from exhausting memory by streaming
 * oversized payloads. Routes that legitimately need larger bodies (e.g.
 * dispute evidence uploads) override this at the route level.
 */
const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024;

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
    bodyLimit: DEFAULT_BODY_LIMIT_BYTES,
  }).withTypeProvider<ZodTypeProvider>();

  // Ensure native BigInt values serialize cleanly to strings across all Fastify JSON responses
  if (!('toJSON' in BigInt.prototype)) {
    Object.defineProperty(BigInt.prototype, 'toJSON', {
      value: function (this: bigint) {
        return this.toString();
      },
      writable: true,
      configurable: true,
    });
  }

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);
  app.setNotFoundHandler((request, reply) => {
    void reply.status(404).send({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
      requestId: request.id,
    });
  });

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

/**
 * Recursively sorts object keys so the exported OpenAPI document has a
 * deterministic ordering suitable for review and diffing. Arrays keep their
 * original order (route/schema ordering is meaningful).
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Builds the API from the real route registrations and returns the current
 * OpenAPI document as a deterministically-ordered JSON string. Never calls
 * `listen()` and never starts background workers, so it is safe to run in a
 * disposable environment for client tooling or offline API review.
 *
 * The caller is responsible for closing the returned app (see
 * scripts/export-openapi.ts) so initialized dependencies are released.
 */
export async function exportOpenApiDocument(): Promise<{
  app: Awaited<ReturnType<typeof buildApp>>;
  document: string;
}> {
  const app = await buildApp();
  await app.ready();
  const document = sortKeysDeep(app.swagger());
  return { app, document: JSON.stringify(document, null, 2) + '\n' };
}
