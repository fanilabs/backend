import { PrismaClient } from '@prisma/client';
import { createPrismaEventStore } from '../../src/modules/indexer/infrastructure/prisma-event-store.js';

async function main() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test environment required');
  const [network, rpcEventId] = process.argv.slice(2);
  if (!network || !rpcEventId) throw new Error('Fixture identity required');
  const prisma = new PrismaClient();
  try {
    await createPrismaEventStore(prisma).tryInsert({
      contractName: 'delivery',
      network,
      rpcEventId,
      ledgerSeq: 1n,
      txHash: 'fixture',
      topic: ['delivery_created'],
      payload: [],
      closedAt: new Date('2026-10-28'),
    });
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
