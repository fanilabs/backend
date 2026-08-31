import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireRole } from '../../../shared/http/index.js';
import type { createAssessActorUseCase } from '../application/index.js';
import { actorAddressParamsSchema, assessActorResponseSchema } from './schemas.js';

export interface FraudDetectionUseCases {
  assessActor: ReturnType<typeof createAssessActorUseCase>;
}

/** `ADMIN`-gated, same reasoning as `analytics` — exposing who is
 * currently flagged is an internal risk-ops concern, not public
 * information (it could tip off exactly the actors it's meant to catch). */
export function createFraudDetectionRoutes(
  useCases: FraudDetectionUseCases,
): FastifyPluginAsyncZod {
  return async function fraudDetectionRoutes(app) {
    app.get(
      '/fraud-detection/actors/:address',
      {
        preHandler: [authenticate, requireRole('ADMIN')],
        schema: {
          security: [{ bearerAuth: [] }],
          description: 'Requires ADMIN role.',
          params: actorAddressParamsSchema,
          response: { 200: assessActorResponseSchema },
        },
      },
      async (request, reply) => {
        const assessment = await useCases.assessActor({ address: request.params.address });
        void reply.status(200).send(ok(assessment));
      },
    );
  };
}
