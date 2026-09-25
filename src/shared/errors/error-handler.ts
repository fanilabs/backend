import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, InternalError, ValidationError } from './app-error.js';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  /** Fastify request id — appears in the request log line, so a user reporting
   * an error can share this and support can correlate it to a logged incident. */
  requestId: string;
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
  const requestId = request.id;
  if (error instanceof AppError) {
    // 5xx details (e.g. DB connection strings, RPC payloads) are logged
    // server-side but never echoed back to clients, so they can't leak.
    const body: ErrorResponseBody = {
      error:
        error.statusCode >= 500
          ? { code: error.code, message: error.message }
          : { code: error.code, message: error.message, details: error.details },
      requestId,
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
    // Normalized through ValidationError so the class and the response can't
    // drift: the status/code below are read off the instance, not hardcoded.
    const validationError = new ValidationError('Request validation failed', zodToDetails(error));
    const body: ErrorResponseBody = {
      error: {
        code: validationError.code,
        message: validationError.message,
        details: validationError.details,
      },
      requestId,
    };
    void reply.status(validationError.statusCode).send(body);
    return;
  }

  // Fastify's schema validation (fastify-type-provider-zod's validatorCompiler)
  // does not throw a bare ZodError for route body/query/params validation —
  // it wraps failures into a FastifyError carrying a `.validation` array and
  // `code: 'FST_ERR_VALIDATION'`. Normalized here to the same VALIDATION_ERROR
  // shape as the ZodError branch above, so API consumers see one consistent
  // code regardless of which path a validation failure took.
  const fastifyValidationError = error as FastifyError;
  if (Array.isArray(fastifyValidationError.validation)) {
    const validationError = new ValidationError(
      'Request validation failed',
      fastifyValidationError.validation,
    );
    const body: ErrorResponseBody = {
      error: {
        code: validationError.code,
        message: validationError.message,
        details: validationError.details,
      },
      requestId,
    };
    void reply.status(validationError.statusCode).send(body);
    return;
  }

  if (isPrismaKnownRequestError(error)) {
    if (error.code === 'P2002') {
      const body: ErrorResponseBody = {
        error: { code: 'CONFLICT', message: 'Resource already exists', details: error.meta },
        requestId,
      };
      void reply.status(409).send(body);
      return;
    }
    if (error.code === 'P2025') {
      const body: ErrorResponseBody = {
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
        requestId,
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
        requestId,
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
        requestId,
      };
      void reply.status(409).send(body);
      return;
    }
    if (error.code === 'P1001' || error.code === 'P1002') {
      const body: ErrorResponseBody = {
        error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is currently unreachable' },
        requestId,
      };
      void reply.status(503).send(body);
      return;
    }
  }

  const fastifyError = error as FastifyError;
  if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode < 500) {
    const body: ErrorResponseBody = {
      error: { code: fastifyError.code ?? 'BAD_REQUEST', message: fastifyError.message },
      requestId,
    };
    request.log.warn({ err: error }, error.message);
    void reply.status(fastifyError.statusCode).send(body);
    return;
  }

  request.log.error({ err: error }, 'Unhandled error');
  // Constructed via InternalError so the class and the fallback response can't
  // drift independently — status/code are read off the instance below.
  const internalError = new InternalError('An unexpected error occurred');
  const body: ErrorResponseBody = {
    error: { code: internalError.code, message: internalError.message },
    requestId,
  };
  void reply.status(internalError.statusCode).send(body);
}
