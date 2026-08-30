import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getConfig } from '../../config/index.js';
import { getRedisClient } from '../../cache/index.js';

/**
 * Baseline security posture applied to every route: Helmet's default
 * strict CSP, an allow-listed CORS origin (never `*` with credentials),
 * and a Redis-backed rate limiter so limits hold across multiple API
 * instances instead of resetting per-process.
 *
 * Individual routes (e.g. Swagger UI) may relax specific headers locally —
 * see src/shared/http/plugins/docs.ts — rather than weakening this default.
 */
export default fp(async function securityPlugin(app: FastifyInstance) {
  const config = getConfig();

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    // Helmet's default is `same-origin`, which is enforced by browsers
    // independently of CORS: it blocks allow-listed cross-origin clients
    // from loading this API's responses at all via a no-CORS-mode request
    // (e.g. displaying an uploaded evidence image with `<img src=...>`).
    // Since CORS_ORIGIN already allow-lists the cooperating client origins,
    // relax CORP to let those resources load — `same-origin` would silently
    // break them regardless of the CORS configuration.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    redis: getRedisClient(),
    // A Redis outage must degrade rate limiting, not take the entire API
    // down — every route's preHandler hook otherwise throws on every
    // request the moment the store is unreachable (verified by hand: this
    // was a real 500-on-everything bug during local smoke testing).
    skipOnError: true,
  });
});
