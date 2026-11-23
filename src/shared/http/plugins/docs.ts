import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

/**
 * OpenAPI 3.1 generation from the same Zod schemas used for request/response
 * validation (ARCHITECTURE.md §9) — one schema, not a hand-maintained copy
 * that drifts from the real validators.
 */
export default fp(async function docsPlugin(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FaniLab Backend API',
        description: 'Off-chain API complementing the FaniLab Soroban smart contracts.',
        version: '0.1.0',
      },
      servers: [{ url: '/api/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/api-docs',
  });
});

/**
 * Recursively sort object keys so the exported document has deterministic
 * ordering suitable for review and diffing. Arrays keep their order.
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
 * Serialize the OpenAPI document registered on a ready Fastify instance to
 * deterministic JSON. Paths and schemas come from the real route
 * registrations; no port is listened on and no background workers are started.
 */
export function serializeOpenApiDocument(app: FastifyInstance): string {
  const document = app.swagger();
  return `${JSON.stringify(sortKeysDeep(document), null, 2)}\n`;
}
