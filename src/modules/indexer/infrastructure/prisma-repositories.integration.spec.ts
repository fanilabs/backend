import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaCheckpointRepository } from './prisma-checkpoint-repository.js';
import { createPrismaEventStore } from './prisma-event-store.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma indexer repositories (integration)', () => {
  const prisma = new PrismaClient();
  const checkpointRepository = createPrismaCheckpointRepository(prisma);
  const eventStore = createPrismaEventStore(prisma);
  const contractName = `test-contract-${randomUUID()}`;
  const network = 'testnet';

  afterAll(async () => {
    await prisma.blockchainEvent.deleteMany({ where: { contractName } });
    await prisma.blockchainCheckpoint.deleteMany({ where: { contractName } });
    await prisma.$disconnect();
  });

  it('returns null for a contract with no checkpoint yet, then persists and reads one back', async () => {
    expect(await checkpointRepository.get(contractName, network)).toBeNull();

    await checkpointRepository.advance(contractName, network, 1000n);
    expect(await checkpointRepository.get(contractName, network)).toMatchObject({
      lastLedgerSeq: 1000n,
    });

    await checkpointRepository.advance(contractName, network, 1050n);
    expect(await checkpointRepository.get(contractName, network)).toMatchObject({
      lastLedgerSeq: 1050n,
    });
  });

  it('isolates checkpoint keys by both contract and network', async () => {
    const contractA = `test-contract-a-${randomUUID()}`;
    const contractB = `test-contract-b-${randomUUID()}`;
    const networkA = 'testnet';
    const networkB = 'mainnet';

    const tuples = [
      { contractName: contractA, network: networkA, ledger: 100n },
      { contractName: contractA, network: networkB, ledger: 200n },
      { contractName: contractB, network: networkA, ledger: 300n },
      { contractName: contractB, network: networkB, ledger: 400n },
    ];

    try {
      for (const tuple of tuples) {
        await checkpointRepository.advance(tuple.contractName, tuple.network, tuple.ledger);
      }

      for (const tuple of tuples) {
        expect(await checkpointRepository.get(tuple.contractName, tuple.network)).toMatchObject({
          lastLedgerSeq: tuple.ledger,
        });
      }

      const updated = tuples[1];
      await checkpointRepository.advance(updated.contractName, updated.network, 250n);

      for (const tuple of tuples) {
        const expected = tuple === updated ? 250n : tuple.ledger;
        expect(await checkpointRepository.get(tuple.contractName, tuple.network)).toMatchObject({
          lastLedgerSeq: expected,
        });
      }

      expect(
        await checkpointRepository.get(`unknown-contract-${randomUUID()}`, networkA),
      ).toBeNull();
    } finally {
      await prisma.blockchainCheckpoint.deleteMany({
        where: { contractName: { in: [contractA, contractB] } },
      });
    }
  });

  it('inserts a new event and rejects (idempotently) a duplicate rpcEventId', async () => {
    const rpcEventId = `evt-${randomUUID()}`;
    const event = {
      contractName,
      network,
      rpcEventId,
      ledgerSeq: 500n,
      txHash: 'tx-hash',
      topic: ['escrow_funded'],
      payload: { amount: '100' },
      closedAt: new Date(),
    };

    expect(await eventStore.tryInsert(event)).toBe(true);
    expect(await eventStore.tryInsert(event)).toBe(false);

    const stored = await prisma.blockchainEvent.findMany({ where: { contractName, rpcEventId } });
    expect(stored).toHaveLength(1);
  });
});
