import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { handleError } from './error-handler.js';
import { AppError } from './app-error.js';

class BlockchainError extends AppError {
  readonly statusCode = 502;
  readonly code = 'BLOCKCHAIN_ERROR';
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

class InternalError extends AppError {
  readonly statusCode = 500;
  readonly code = 'INTERNAL_ERROR';
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

class ClientError extends AppError {
  readonly statusCode = 400;
  readonly code = 'BAD_REQUEST';
  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

describe('error-handler', () => {
  function createMockReply(): FastifyReply {
    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      header: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    return mockReply;
  }

  function createMockRequest(
    logFn: (level: string, arg: unknown, msg: string) => void,
  ): FastifyRequest {
    const mockRequest = {
      id: 'req-123',
      log: {
        error: (arg: unknown, msg: string) => logFn('error', arg, msg),
        warn: (arg: unknown, msg: string) => logFn('warn', arg, msg),
      },
    } as unknown as FastifyRequest;
    return mockRequest;
  }

  it('masks details on 5xx AppError responses but logs them server-side', () => {
    const logs: Array<{ level: string; details: unknown }> = [];
    const logFn = (level: string, details: unknown) => {
      logs.push({ level, details });
    };

    const reply = createMockReply();
    const request = createMockRequest((level, arg) => logFn(level, arg));

    const error = new BlockchainError('Soroban RPC call failed', {
      operation: 'simulate_transaction',
      cause: 'Connection timeout',
    });

    handleError(error, request, reply);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.message).toBe('Soroban RPC call failed');
    expect(sendArg.error.code).toBe('BLOCKCHAIN_ERROR');
    expect(sendArg.error.details).toBeUndefined();
    expect(sendArg.requestId).toBe('req-123');

    expect(logs.length).toBeGreaterThan(0);
    const errorLog = logs.find((log) => log.level === 'error');
    expect(errorLog).toBeDefined();
  });

  it('masks 500-level error details but preserves the error code', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const error = new InternalError('Database connection failed', {
      connectionString: 'postgres://...',
      stackTrace: 'Error: at connect ...',
    });

    handleError(error, request, reply);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.code).toBe('INTERNAL_ERROR');
    expect(sendArg.error.details).toBeUndefined();
  });

  it('preserves details on 4xx AppError responses', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const error = new ClientError('Validation failed', { email: 'invalid format' });

    handleError(error, request, reply);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.message).toBe('Validation failed');
    expect(sendArg.error.details).toEqual({ email: 'invalid format' });
  });

  it('logs 5xx errors at error level', () => {
    const logs: Array<{ level: string }> = [];
    const logFn = (level: string) => {
      logs.push({ level });
    };

    const reply = createMockReply();
    const request = createMockRequest((level, _arg) => logFn(level));

    const error = new BlockchainError('RPC failure', { cause: 'timeout' });

    handleError(error, request, reply);

    const errorLogs = logs.filter((log) => log.level === 'error');
    expect(errorLogs.length).toBeGreaterThan(0);
  });

  it('logs 4xx errors at warn level', () => {
    const logs: Array<{ level: string }> = [];
    const logFn = (level: string) => {
      logs.push({ level });
    };

    const reply = createMockReply();
    const request = createMockRequest((level, _arg) => logFn(level));

    const error = new ClientError('Bad request', {});

    handleError(error, request, reply);

    const warnLogs = logs.filter((log) => log.level === 'warn');
    expect(warnLogs.length).toBeGreaterThan(0);
  });

  it('returns status code matching the error', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const error = new BlockchainError('Service unavailable', {});

    handleError(error, request, reply);

    expect((reply.status as any).mock.calls[0]?.[0]).toBe(502);
  });

  it('masks non-AppError exceptions to generic message', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const genericError = new Error('Unexpected failure');

    handleError(genericError as any, request, reply);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.message).toBe('An unexpected error occurred');
    expect(sendArg.error.code).toBe('INTERNAL_ERROR');
    expect(sendArg.requestId).toBe('req-123');
  });

  it('includes the request id on 4xx validation responses', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const error = new ClientError('Bad request', {});

    handleError(error, request, reply);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.requestId).toBe('req-123');
  });

  it('maps Prisma P2024 to HTTP 503 DATABASE_TIMEOUT with Retry-After header', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const prismaError = {
      code: 'P2024',
      message: 'Timed out fetching a new connection from the pool',
    } as any;

    handleError(prismaError, request, reply);

    expect((reply.status as any).mock.calls[0]?.[0]).toBe(503);
    expect((reply.header as any).mock.calls[0]?.[0]).toBe('Retry-After');
    expect((reply.header as any).mock.calls[0]?.[1]).toBe('1');

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.code).toBe('DATABASE_TIMEOUT');
    expect(sendArg.error.message).toBe('Timed out fetching a new connection from the pool');
    expect(sendArg.requestId).toBe('req-123');
  });

  it('maps Prisma P2000 to HTTP 400 VALUE_TOO_LONG with column details', () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const prismaError = {
      code: 'P2000',
      message: "The provided value for the column is too long for the column's type.",
      meta: { column_name: 'recipient_address' },
    } as any;

    handleError(prismaError, request, reply);

    expect((reply.status as any).mock.calls[0]?.[0]).toBe(400);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.code).toBe('VALUE_TOO_LONG');
    expect(sendArg.error.details).toEqual({ column_name: 'recipient_address' });
    expect(sendArg.requestId).toBe('req-123');
  });
  it("maps Prisma P2004 check constraint violation to HTTP 400 VALIDATION_ERROR", () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const prismaError = {
      code: "P2004",
      message: "A constraint failed on the database: check constraint violation",
      meta: { database_error: "check constraint failed" },
    } as any;

    handleError(prismaError, request, reply);

    expect((reply.status as any).mock.calls[0]?.[0]).toBe(400);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.code).toBe("VALIDATION_ERROR");
    expect(sendArg.error.message).toBe("A database check constraint failed on the provided data");
    expect(sendArg.error.details).toEqual({ database_error: "check constraint failed" });
    expect(sendArg.requestId).toBe("req-123");
  });

  it("maps Prisma P2011 null constraint violation to HTTP 400 VALIDATION_ERROR", () => {
    const reply = createMockReply();
    const request = createMockRequest(() => {});

    const prismaError = {
      code: "P2011",
      message: "Null constraint violation on the constraint: users_email_key",
      meta: { constraint: ["users_email_key"] },
    } as any;

    handleError(prismaError, request, reply);

    expect((reply.status as any).mock.calls[0]?.[0]).toBe(400);

    const sendArg = (reply.send as any).mock.calls[0]?.[0];
    expect(sendArg.error.code).toBe("VALIDATION_ERROR");
    expect(sendArg.error.message).toBe("A required field cannot be null");
    expect(sendArg.error.details).toEqual({ constraint: ["users_email_key"] });
    expect(sendArg.requestId).toBe("req-123");
  });
});
