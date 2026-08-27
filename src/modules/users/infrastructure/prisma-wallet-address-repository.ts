import type { PrismaClient, WalletAddress as PrismaWalletAddress } from '@prisma/client';
import type { WalletAddressRecord, WalletAddressRepository } from '../domain/index.js';

function toDomain(record: PrismaWalletAddress): WalletAddressRecord {
  return {
    id: record.id,
    userId: record.userId,
    address: record.address,
    isPrimary: record.isPrimary,
    verifiedAt: record.verifiedAt,
    createdAt: record.createdAt,
  };
}

export function createPrismaWalletAddressRepository(prisma: PrismaClient): WalletAddressRepository {
  return {
    async findById(id) {
      const record = await prisma.walletAddress.findUnique({ where: { id } });
      return record ? toDomain(record) : null;
    },
    async findByAddress(address) {
      const record = await prisma.walletAddress.findUnique({ where: { address } });
      return record ? toDomain(record) : null;
    },
    async findByUserId(userId) {
      const records = await prisma.walletAddress.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      return records.map(toDomain);
    },
    async create(input) {
      const record = await prisma.walletAddress.create({
        data: {
          userId: input.userId,
          address: input.address,
          isPrimary: input.isPrimary,
          verifiedAt: input.verifiedAt,
        },
      });
      return toDomain(record);
    },
    async remove(id) {
      await prisma.walletAddress.delete({ where: { id } });
    },
  };
}
