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

  it('persists every envelope field exactly, including nested JSON and Unicode topics', async () => {
    const rpcEventId = `evt-${randomUUID()}`;
    const closedAt = new Date('2024-05-01T12:34:56.789Z');
    const topic = ['escrow_funded', 'ñandú-🚀-契約', 'topic-\u0000-with-null'];
    const payload = {
      amount: '100',
      nested: { depth: { deeper: [1, 2, { three: true }] } },
      unicode: 'héllo-世界-🎉',
      nullValue: null,
      list: ['a', 'b'],
    };
    const event = {
      contractName,
      network,
      rpcEventId,
      ledgerSeq: 123456789n,
      txHash: 'tx-hash-fidelity',
      topic,
      payload,
      closedAt,
    };

    expect(await eventStore.tryInsert(event)).toBe(true);

    const stored = await prisma.blockchainEvent.findFirstOrThrow({
      where: { contractName, network, rpcEventId },
    });
    expect(stored.contractName).toBe(contractName);
    expect(stored.network).toBe(network);
    expect(stored.rpcEventId).toBe(rpcEventId);
    expect(stored.ledgerSeq).toBe(123456789n);
    expect(stored.txHash).toBe('tx-hash-fidelity');
    expect(stored.topic).toEqual(topic);
    expect(stored.payload).toEqual(payload);
    expect(stored.closedAt).toEqual(closedAt);
  });

  it('allows the same rpcEventId under a different contract and under a different network', async () => {
    const rpcEventId = `evt-${randomUUID()}`;
    const otherContract = `test-contract-other-${randomUUID()}`;
    const otherNetwork = 'mainnet';
    const base = {
      rpcEventId,
      ledgerSeq: 700n,
      txHash: 'tx-hash-tuple',
      topic: ['escrow_funded'],
      payload: { amount: '100' },
      closedAt: new Date('2024-06-01T00:00:00.000Z'),
    };

    try {
      expect(await eventStore.tryInsert({ ...base, contractName, network })).toBe(true);
      expect(
        await eventStore.tryInsert({ ...base, contractName: otherContract, network }),
      ).toBe(true);
      expect(
        await eventStore.tryInsert({ ...base, contractName, network: otherNetwork }),
      ).toBe(true);

      const stored = await prisma.blockchainEvent.findMany({ where: { rpcEventId } });
      expect(stored).toHaveLength(3);
      expect(stored.map((row) => `${row.contractName}|${row.network}`).sort()).toEqual(
        [
          `${contractName}|${network}`,
          `${otherContract}|${network}`,
          `${contractName}|${otherNetwork}`,
        ].sort(),
      );
    } finally {
      await prisma.blockchainEvent.deleteMany({ where: { rpcEventId } });
    }
  });

  it('rejects unrelated failures instead of treating them as duplicates', async () => {
    const failingPrisma = {
      blockchainEvent: {
        create: async () => {
          throw new Error('connection terminated unexpectedly');
        },
      },
    } as unknown as PrismaClient;
    const failingStore = createPrismaEventStore(failingPrisma);

    await expect(
      failingStore.tryInsert({
        contractName,
        network,
        rpcEventId: `evt-${randomUUID()}`,
        ledgerSeq: 1n,
        txHash: 'tx-hash-failure',
        topic: ['escrow_funded'],
        payload: { amount: '100' },
        closedAt: new Date(),
      }),
    ).rejects.toThrow('connection terminated unexpectedly');
  });
});
