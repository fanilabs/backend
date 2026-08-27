import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { logger } from './shared/logger/index.js';
import { handleError } from './shared/errors/index.js';
import { securityPlugin, docsPlugin, healthRoutes } from './shared/http/index.js';
import { getPrismaClient } from './shared/database/index.js';
import { createAuthModule } from './modules/auth/index.js';
import { createUsersModule } from './modules/users/index.js';
import { createIndexerHealthPlugin } from './modules/indexer/index.js';

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
 * ships in Phase 5 — deliveries/escrow/fleet/disputes/reputation/etc. are
 * not registered yet, and intentionally so, rather than pre-wired ahead of
 * their implementation.
 */
export async function buildApp() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(handleError);

  await app.register(securityPlugin);
  await app.register(docsPlugin);
  await app.register(healthRoutes);

  const prisma = getPrismaClient();
  await app.register(createAuthModule(prisma), { prefix: '/api/v1' });
  await app.register(createUsersModule(prisma), { prefix: '/api/v1' });
  await app.register(createIndexerHealthPlugin(prisma));

  return app;
}
