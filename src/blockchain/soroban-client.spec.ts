import { rpc } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SorobanClient } from './soroban-client.js';

describe('SorobanClient', () => {
  it('sets a finite timeout on the SDK RPC transport', () => {
    new SorobanClient('https://soroban.example.test');

    expect(rpc.AxiosClient.defaults.timeout).toBe(30_000);
  });

  it('configures keepAlive: true on the HTTP and HTTPS agents', () => {
    new SorobanClient('https://soroban.example.test');

    expect(rpc.AxiosClient.defaults.httpAgent?.keepAlive).toBe(true);
    expect(rpc.AxiosClient.defaults.httpsAgent?.keepAlive).toBe(true);
  });
});
