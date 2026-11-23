import { randomBytes } from 'node:crypto';
import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { SorobanClient } from '../../../blockchain/soroban-client.js';
import { createSorobanEventSource } from './soroban-event-source.js';
import { isSorobanRpcAvailable } from '../../../shared/testing/soroban.js';

/**
 * Public-RPC integration tests contact a live network, so they are opt-in.
 * Set SOROBAN_RPC_INTEGRATION=1 (or `true`) to enable them, e.g. via
 * `npm run test:integration:soroban`. Without the flag the probe is never
 * called and the suite is skipped, keeping local unit/database runs offline.
 */
const rpcIntegrationOptIn = ['1', 'true'].includes(
  (process.env.SOROBAN_RPC_INTEGRATION ?? '').toLowerCase(),
);

const rpcAvailable = rpcIntegrationOptIn ? await isSorobanRpcAvailable() : false;

/**
 * No FaniLab contracts are deployed anywhere reachable from this test run
 * (see PHASE_1_DOMAIN_ANALYSIS.md — this repo tracks the smart contracts,
 * it doesn't deploy them), so this can't fetch a real FaniLab event. What
 * it *can* verify against the real public testnet RPC is that the wiring
 * (SorobanClient -> SorobanEventSource -> decoding pipeline) actually
 * talks to a live network correctly, which no fake/mock can prove.
 * Skipped, not failed, if the sandbox running this has no outbound network
 * access to the public endpoint.
 */
describe.skipIf(!rpcIntegrationOptIn)(
  'createSorobanEventSource (real testnet RPC)',
  () => {
    it.skipIf(!rpcAvailable)(
      'reads the real current ledger sequence',
      async () => {
        const client = new SorobanClient();
        const eventSource = createSorobanEventSource(client);

        const latestLedger = await eventSource.getLatestLedger();

        expect(latestLedger).toBeGreaterThan(0);
      },
    );

    it.skipIf(!rpcAvailable)(
      'returns an empty, well-formed result for a contract that does not exist on this network',
      async () => {
        const client = new SorobanClient();
        const eventSource = createSorobanEventSource(client);
        const latestLedger = await eventSource.getLatestLedger();

        // A syntactically valid (correct StrKey checksum), randomly-generated,
        // certainly-undeployed contract id — proves the request/response
        // plumbing and decoding path run end-to-end against a real RPC without
        // throwing, even with zero events to decode. (The all-zero-byte
        // address specifically is rejected by the RPC as invalid — verified by
        // hand — so a random one is used instead of a "nice" placeholder.)
        const placeholderContractId = Address.contract(randomBytes(32)).toString();

        const result = await eventSource.fetchEvents({
          contractId: placeholderContractId,
          startLedger: Math.max(1, latestLedger - 100),
        });

        expect(Array.isArray(result.events)).toBe(true);
        expect(result.latestLedgerSeen).toBeGreaterThan(0);
      },
    );

    it.skipIf(rpcAvailable)(
      'explains when the public RPC endpoint is unavailable',
      () => {
        // Opted in but the endpoint could not be reached: surface a clear
        // explanation instead of silently skipping the connectivity checks.
        console.warn(
          '[soroban-integration] SOROBAN_RPC_INTEGRATION is set but the public ' +
            'Soroban RPC endpoint is unreachable; connectivity assertions were ' +
            'skipped. Check outbound network access or the configured RPC URL.',
        );
        expect(rpcAvailable).toBe(false);
      },
    );
  },
);

/**
 * Offline decoding tests: exercise the nonempty-event transformation path
 * (topic/value XDR decoding, contractId resolution, ledgerClosedAt) with a
 * fake getEvents response, so no live RPC is required.
 */
describe('createSorobanEventSource (offline decoding)', () => {
  const requestedContractId = Address.contract(randomBytes(32)).toString();
  const responseContractId = Address.contract(randomBytes(32)).toString();
  const txHash = randomBytes(32).toString('hex');
  const eventId = '0000000001-0000000001';
  const ledgerClosedAt = '2024-01-02T03:04:05Z';
  const latestLedger = 4242;

  function makeEvent(contractId?: string) {
    const topics = [
      nativeToScVal('transfer', { type: 'symbol' }),
      nativeToScVal([nativeToScVal(1, { type: 'u32' }), nativeToScVal('abc', { type: 'string' })], {
        type: 'vec',
      }),
    ];
    const value = nativeToScVal(1000n, { type: 'i128' });

    return {
      id: eventId,
      type: 'contract',
      ledger: 100,
      ledgerClosedAt,
      contractId,
      txHash,
      topic: topics.map((t) => t.toXDR().toString('base64')),
      value: value.toXDR().toString('base64'),
    };
  }

  function makeClient(events: unknown[]) {
    return {
      getEvents: async () => ({
        events,
        latestLedger,
      }),
    } as unknown as SorobanClient;
  }

  it('decodes a nonempty event with explicit contractId, preserving identity and payload', async () => {
    const eventSource = createSorobanEventSource(makeClient([makeEvent(responseContractId)]));

    const result = await eventSource.fetchEvents({
      contractId: requestedContractId,
      startLedger: 1,
    });

    expect(result.latestLedgerSeen).toBe(latestLedger);
    expect(result.events).toHaveLength(1);

    const [event] = result.events;
    expect(event.id).toBe(eventId);
    expect(event.txHash).toBe(txHash);
    expect(event.ledger).toBe(100);
    expect(event.ledgerClosedAt).toBe(ledgerClosedAt);
    expect(event.contractId).toBe(responseContractId);

    // Symbol topics stay strings; tuple topics use the established JSON form.
    expect(event.topics[0]).toBe('transfer');
    expect(typeof event.topics[1]).toBe('string');
    expect(JSON.parse(event.topics[1] as string)).toEqual([1, 'abc']);

    expect(event.value).toBe('1000');
  });

  it('falls back to the requested contractId when the response omits it', async () => {
    const eventSource = createSorobanEventSource(makeClient([makeEvent(undefined)]));

    const result = await eventSource.fetchEvents({
      contractId: requestedContractId,
      startLedger: 1,
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].contractId).toBe(requestedContractId);
  });
});
