import { rpc } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SorobanClient } from './soroban-client.js';

describe('SorobanClient', () => {
  it('sets a finite timeout on the SDK RPC transport', () => {
    new SorobanClient('https://soroban.example.test');

    expect(rpc.AxiosClient.defaults.timeout).toBe(30_000);
  });
});
