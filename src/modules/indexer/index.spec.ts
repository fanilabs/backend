import { describe, expect, it } from 'vitest';
import { getTrackedContracts } from './index.js';

/**
 * Regression coverage for the five-contract indexer scope (see this file's
 * `getTrackedContracts` doc comment). A stale parallel-branch merge had
 * regressed this back down to escrow + delivery only, silently cutting off
 * the `fleet`, `disputes`, and `reputation` modules' event subscriptions
 * (each wired via the shared event bus in their own `index.ts`, independent
 * of what the indexer actually polls) from ever receiving events.
 */
describe('getTrackedContracts', () => {
  it('tracks all five contracts with a consuming module', () => {
    const contractNames = getTrackedContracts().map((contract) => contract.contractName);

    expect(contractNames).toEqual([
      'escrow',
      'delivery',
      'fleet',
      'dispute-resolution',
      'identity-reputation',
    ]);
  });

  it('never tracks settlement_contract — no consuming module exists for it', () => {
    const contractNames = getTrackedContracts().map((contract) => contract.contractName);

    expect(contractNames).not.toContain('settlement');
  });

  it('leaves unconfigured contract ids as undefined rather than inventing a value', () => {
    // Test env deliberately leaves *_CONTRACT_ID unset (src/shared/testing/env.ts),
    // matching the "not deployed in this environment" convention every other
    // contract id already follows.
    for (const contract of getTrackedContracts()) {
      expect(contract.contractId).toBeUndefined();
    }
  });
});
