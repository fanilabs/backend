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
    };

    expect(await eventStore.tryInsert(event)).toBe(true);
    expect(await eventStore.tryInsert(event)).toBe(false);

    const stored = await prisma.blockchainEvent.findMany({ where: { contractName, rpcEventId } });
    expect(stored).toHaveLength(1);
  });
});
