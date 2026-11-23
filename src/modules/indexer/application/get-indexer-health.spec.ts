import { describe, expect, it } from 'vitest';
import { createGetIndexerHealthUseCase } from './get-indexer-health.js';
import { createFakeEventSource, createInMemoryCheckpointRepository } from './__fixtures__/fakes.js';

describe('getIndexerHealth', () => {
  it('reports an unconfigured contract as healthy with no lag data', async () => {
    const checkpointRepository = createInMemoryCheckpointRepository();
    const eventSource = createFakeEventSource();
    const getIndexerHealth = createGetIndexerHealthUseCase({ checkpointRepository, eventSource });

    const result = await getIndexerHealth({
      network: 'testnet',
      trackedContracts: [{ contractName: 'escrow', contractId: undefined }],
      lagAlertThreshold: 50,
    });

    expect(result.healthy).toBe(true);
    expect(result.contracts[0]).toMatchObject({
      configured: false,
      lagLedgers: null,
      healthy: true,
    });
  });

  it('computes lag for a configured contract with a checkpoint', async () => {
    const checkpointRepository = createInMemoryCheckpointRepository();
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 950n,
      updatedAt: new Date(),
    });
    const eventSource = createFakeEventSource();
    eventSource.latestLedger = 1000;
    const getIndexerHealth = createGetIndexerHealthUseCase({ checkpointRepository, eventSource });

    const result = await getIndexerHealth({
      network: 'testnet',
      trackedContracts: [{ contractName: 'escrow', contractId: 'C_ESCROW' }],
      lagAlertThreshold: 50,
    });

    expect(result.contracts[0]).toMatchObject({ configured: true, lagLedgers: 50, healthy: true });
  });

  it('marks a configured contract unhealthy once lag exceeds the threshold', async () => {
    const checkpointRepository = createInMemoryCheckpointRepository();
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 800n,
      updatedAt: new Date(),
    });
    const eventSource = createFakeEventSource();
    eventSource.latestLedger = 1000;
    const getIndexerHealth = createGetIndexerHealthUseCase({ checkpointRepository, eventSource });

    const result = await getIndexerHealth({
      network: 'testnet',
      trackedContracts: [{ contractName: 'escrow', contractId: 'C_ESCROW' }],
      lagAlertThreshold: 50,
    });

    expect(result.contracts[0]?.healthy).toBe(false);
    expect(result.healthy).toBe(false);
  });

  it('aggregates mixed contracts in input order using checkpoints from the requested network', async () => {
    const checkpointRepository = createInMemoryCheckpointRepository();
    const updatedAt = new Date('2026-01-01T00:00:00Z');
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'testnet',
      lastLedgerSeq: 900n,
      updatedAt,
    });
    checkpointRepository.seed({
      contractName: 'escrow',
      network: 'mainnet',
      lastLedgerSeq: 999n,
      updatedAt,
    });
    checkpointRepository.seed({
      contractName: 'delivery',
      network: 'testnet',
      lastLedgerSeq: 950n,
      updatedAt,
    });
    const eventSource = createFakeEventSource();
    eventSource.latestLedger = 1000;
    const getIndexerHealth = createGetIndexerHealthUseCase({ checkpointRepository, eventSource });

    const result = await getIndexerHealth({
      network: 'testnet',
      trackedContracts: [
        { contractName: 'escrow', contractId: 'C_ESCROW' },
        { contractName: 'reputation', contractId: undefined },
        { contractName: 'delivery', contractId: 'C_DELIVERY' },
      ],
      lagAlertThreshold: 50,
    });

    expect(result).toStrictEqual({
      latestLedger: 1000,
      healthy: false,
      contracts: [
        {
          contractName: 'escrow',
          configured: true,
          lastLedgerSeq: '900',
          lagLedgers: 100,
          healthy: false,
        },
        {
          contractName: 'reputation',
          configured: false,
          lastLedgerSeq: null,
          lagLedgers: null,
          healthy: true,
        },
        {
          contractName: 'delivery',
          configured: true,
          lastLedgerSeq: '950',
          lagLedgers: 50,
          healthy: true,
        },
      ],
    });
    expect(eventSource.fetchEventsCalls).toEqual([]);
  });

  it('treats a configured contract with no checkpoint yet as healthy (not started, not broken)', async () => {
    const checkpointRepository = createInMemoryCheckpointRepository();
    const eventSource = createFakeEventSource();
    const getIndexerHealth = createGetIndexerHealthUseCase({ checkpointRepository, eventSource });

    const result = await getIndexerHealth({
      network: 'testnet',
      trackedContracts: [{ contractName: 'escrow', contractId: 'C_ESCROW' }],
      lagAlertThreshold: 50,
    });

    expect(result.contracts[0]).toMatchObject({
      configured: true,
      lastLedgerSeq: null,
      healthy: true,
    });
  });
});
