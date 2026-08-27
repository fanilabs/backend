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

/**
 * Composes the Fastify instance with no side effects (no `listen()` call) so
 * it can be built once for the real server (src/server.ts) and again,
 * identically, inside API tests via `app.inject()`.
 *
 * Request logging volume is controlled by the shared logger's level (see
 * src/shared/logger/index.ts — silent by default in `test`), not by a
 * per-instance Fastify flag.
 *
 * Module route registration (auth, users, deliveries, ...) is added here
 * incrementally as each module ships in Phase 5 — this scaffold
 * intentionally registers nothing beyond the cross-cutting plugins and the
 * health check.
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

  await app.register(createAuthModule(getPrismaClient()), { prefix: '/api/v1' });

  return app;
}
