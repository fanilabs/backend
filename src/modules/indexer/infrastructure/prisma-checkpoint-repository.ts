import type { PrismaClient } from '@prisma/client';
import type { CheckpointRepository } from '../domain/index.js';

export function createPrismaCheckpointRepository(prisma: PrismaClient): CheckpointRepository {
  return {
    async get(contractName, network) {
      const record = await prisma.blockchainCheckpoint.findUnique({
        where: { contractName_network: { contractName, network } },
      });
      return record
        ? {
            contractName: record.contractName,
            network: record.network,
            lastLedgerSeq: record.lastLedgerSeq,
            updatedAt: record.updatedAt,
          }
        : null;
    },
    async advance(contractName, network, lastLedgerSeq) {
      await prisma.blockchainCheckpoint.upsert({
        where: { contractName_network: { contractName, network } },
        create: { contractName, network, lastLedgerSeq },
        update: { lastLedgerSeq },
      });
    },
  };
}
