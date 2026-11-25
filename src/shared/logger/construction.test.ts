import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pinoMock = vi.fn().mockReturnValue({});
const getConfigMock = vi.fn();

vi.mock('pino', () => {
  const stdSerializers = { wrapErrorSerializer: (fn: unknown) => fn };
  return {
    default: Object.assign(pinoMock, { stdSerializers }),
    stdSerializers,
  };
});

vi.mock('../config/index.js', () => ({
  getConfig: getConfigMock,
}));

describe('process-wide logger construction', () => {
  beforeEach(() => {
    vi.resetModules();
    pinoMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('includes a pino-pretty transport and the configured level/serializers in development', async () => {
    getConfigMock.mockReturnValue({ NODE_ENV: 'development', LOG_LEVEL: 'info' });

    await import('./index.js');

    expect(pinoMock).toHaveBeenCalledTimes(1);
    const options = pinoMock.mock.calls[0][0];
    expect(options.level).toBe('info');
    expect(options.transport).toEqual({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss' },
    });
    expect(options.serializers.err).toBeDefined();
    expect(options.serializers.error).toBeDefined();
  });

  it('omits any transport in production, keeping level/serializers wired', async () => {
    getConfigMock.mockReturnValue({ NODE_ENV: 'production', LOG_LEVEL: 'warn' });

    await import('./index.js');

    const options = pinoMock.mock.calls[0][0];
    expect(options.level).toBe('warn');
    expect(options.transport).toBeUndefined();
    expect(options.serializers.err).toBeDefined();
    expect(options.serializers.error).toBeDefined();
  });

  it('omits any transport in test, keeping level/serializers wired', async () => {
    getConfigMock.mockReturnValue({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

    await import('./index.js');

    const options = pinoMock.mock.calls[0][0];
    expect(options.level).toBe('silent');
    expect(options.transport).toBeUndefined();
    expect(options.serializers.err).toBeDefined();
    expect(options.serializers.error).toBeDefined();
  });
});
