import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from './app-error.js';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Duck-typed check — avoids a hard import dependency on @prisma/client's
 * generated error classes from this generic, framework-facing module. */
function isPrismaKnownRequestError(
  error: unknown,
): error is { code: string; meta?: Record<string, unknown> } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^P\d{4}$/.test((error as { code: string }).code)
  );
}

function zodToDetails(error: ZodError): unknown {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * The single point where every thrown error becomes an HTTP response.
 * Registered via `app.setErrorHandler(...)` in src/app.ts. Nothing else in
 * the codebase should call `reply.send` directly from a `catch` block —
 * throw an AppError subclass (or let an unexpected error propagate) instead.
 */
export function handleError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof AppError) {
    const body: ErrorResponseBody = {
      error: { code: error.code, message: error.message, details: error.details },
    };
    if (error.statusCode >= 500) {
      request.log.error({ err: error }, error.message);
    } else {
      request.log.warn({ err: error }, error.message);
    }
    void reply.status(error.statusCode).send(body);
    return;
  }

  if (error instanceof ZodError) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: zodToDetails(error),
      },
    };
    void reply.status(400).send(body);
    return;
  }

  // Fastify's schema validation (fastify-type-provider-zod's validatorCompiler)
  // does not throw a bare ZodError for route body/query/params validation —
  // it wraps failures into a FastifyError carrying a `.validation` array and
  // `code: 'FST_ERR_VALIDATION'`. Normalized here to the same VALIDATION_ERROR
  // shape as the ZodError branch above, so API consumers see one consistent
  // code regardless of which path a validation failure took.
  const validationError = error as FastifyError;
  if (Array.isArray(validationError.validation)) {
    const body: ErrorResponseBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: validationError.validation,
      },
    };
    void reply.status(400).send(body);
    return;
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === 'P2002') {
      const body: ErrorResponseBody = {
        error: { code: 'CONFLICT', message: 'Resource already exists', details: error.meta },
      };
      void reply.status(409).send(body);
      return;
    }
    if (error.code === 'P2025') {
      const body: ErrorResponseBody = {
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      };
      void reply.status(404).send(body);
      return;
    }
    if (error.code === 'P2003') {
      const body: ErrorResponseBody = {
        error: {
          code: 'RELATED_RESOURCE_MISSING',
          message: 'A related resource required by this operation does not exist',
          details: error.meta,
        },
      };
      void reply.status(409).send(body);
      return;
    }
    if (error.code === 'P2034') {
      const body: ErrorResponseBody = {
        error: {
          code: 'WRITE_CONFLICT',
          message: 'The write conflicted with a concurrent transaction and may be retried',
        },
      };
      void reply.status(409).send(body);
      return;
    }
    if (error.code === 'P1001' || error.code === 'P1002') {
      const body: ErrorResponseBody = {
        error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is currently unreachable' },
      };
      void reply.status(503).send(body);
      return;
    }
  }

  const fastifyError = error as FastifyError;
  if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
    const body: ErrorResponseBody = {
      error: { code: fastifyError.code ?? 'BAD_REQUEST', message: fastifyError.message },
    };
    request.log.warn({ err: error }, error.message);
    void reply.status(fastifyError.statusCode).send(body);
    return;
  }

  request.log.error({ err: error }, 'Unhandled error');
  const body: ErrorResponseBody = {
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  };
  void reply.status(500).send(body);
}
