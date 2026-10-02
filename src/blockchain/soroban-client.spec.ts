import { rpc } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SorobanClient } from './soroban-client.js';

describe('SorobanClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sets a finite timeout on the SDK RPC transport', () => {
    new SorobanClient('https://soroban.example.test');

    expect(rpc.AxiosClient.defaults.timeout).toBe(30_000);
  });

  it('configures keepAlive: true on the HTTP and HTTPS agents', () => {
    new SorobanClient('https://soroban.example.test');

    expect(rpc.AxiosClient.defaults.httpAgent?.keepAlive).toBe(true);
    expect(rpc.AxiosClient.defaults.httpsAgent?.keepAlive).toBe(true);
  });

  // Issue #275: a rate-limited (HTTP 429) response from the shared public RPC
  // provider is transient, so it must be backed off and retried rather than
  // failing the whole operation on the first rejection.
  it('retries an RPC call that fails with HTTP 429 Too Many Requests', async () => {
    const client = new SorobanClient('https://soroban.example.test');
    const getHealth = vi
      .spyOn(client.raw, 'getHealth')
      .mockRejectedValueOnce(new Error('Request failed with status code 429'))
      .mockResolvedValueOnce({
        status: 'healthy',
      } as Awaited<ReturnType<rpc.Server['getHealth']>>);

    vi.useFakeTimers();
    const pending = client.getHealth();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ status: 'healthy' });
    expect(getHealth).toHaveBeenCalledTimes(2);
  });

  it('still does not retry a well-formed RPC error response', async () => {
    const client = new SorobanClient('https://soroban.example.test');
    const getHealth = vi
      .spyOn(client.raw, 'getHealth')
      .mockRejectedValue({ code: -32602, message: 'invalid transaction' });

    await expect(client.getHealth()).rejects.toThrow('Soroban RPC call failed: getHealth');
    expect(getHealth).toHaveBeenCalledTimes(1);
  });
});
