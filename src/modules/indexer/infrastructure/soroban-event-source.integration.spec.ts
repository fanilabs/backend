import { randomBytes } from 'node:crypto';
import { Address } from '@stellar/stellar-sdk';
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
