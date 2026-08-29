import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { handleError } from './error-handler.js';
import { AppError } from './app-error.js';

class BlockchainError extends AppError {
  constructor(message: string, details?: unknown) {
    super('BLOCKCHAIN_ERROR', message, 502, details);
  }
}

class InternalError extends AppError {
  constructor(message: string, details?: unknown) {
    super('INTERNAL_ERROR', message, 500, details);
  }
}

class ClientError extends AppError {
  constructor(message: string, details?: unknown) {
    super('BAD_REQUEST', message, 400, details);
  }
}

describe('error-handler', () => {
  function createMockReply(): FastifyReply {
    const mockReply = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    } as unknown as FastifyReply;
    return mockReply;
  }

  function createMockRequest(logFn: (level: string, arg: unknown, msg: string) => void): FastifyRequest {
    const mockRequest = {
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
  });
});
