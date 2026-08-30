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
