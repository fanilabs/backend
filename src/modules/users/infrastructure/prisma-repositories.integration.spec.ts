import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaUserReader } from './prisma-user-reader.js';
import { createPrismaWalletAddressRepository } from './prisma-wallet-address-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma users repositories (integration)', () => {
  const prisma = new PrismaClient();
  const userReader = createPrismaUserReader(prisma);
  const walletAddressRepository = createPrismaWalletAddressRepository(prisma);
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.walletAddress.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `test-${randomUUID()}@example.com`, passwordHash: 'hash', role: 'CUSTOMER' },
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  it('reads a user by id with only the expected fields', async () => {
    const userId = await seedUser();

    const record = await userReader.findById(userId);

    expect(record).toMatchObject({ id: userId, role: 'CUSTOMER' });
    expect(record).not.toHaveProperty('passwordHash');
  });

  it('returns null for an unknown user id', async () => {
    expect(await userReader.findById(randomUUID())).toBeNull();
  });

  it('creates, finds, and removes a wallet address', async () => {
    const userId = await seedUser();
    const address = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;

    const created = await walletAddressRepository.create({
      userId,
      address,
      isPrimary: true,
      verifiedAt: new Date(),
    });

    expect(await walletAddressRepository.findById(created.id)).toMatchObject({ address });
    expect(await walletAddressRepository.findByAddress(address)).toMatchObject({ userId });
    expect(await walletAddressRepository.findByUserId(userId)).toHaveLength(1);

    await walletAddressRepository.remove(created.id);
    expect(await walletAddressRepository.findById(created.id)).toBeNull();
  });

  it('rejects a second primary wallet for the same user via the partial unique index', async () => {
    const userId = await seedUser();
    const addressA = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const addressB = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;

    // Two concurrent confirmations for a brand-new user, both believing they
    // are creating the first (primary) wallet.
    const results = await Promise.allSettled([
      walletAddressRepository.create({ userId, address: addressA, isPrimary: true, verifiedAt: new Date() }),
      walletAddressRepository.create({ userId, address: addressB, isPrimary: true, verifiedAt: new Date() }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser can still be linked as a non-primary wallet.
    const loserAddress = fulfilled[0]?.status === 'fulfilled' && fulfilled[0].value.address === addressA
      ? addressB
      : addressA;
    await walletAddressRepository.create({
      userId,
      address: loserAddress,
      isPrimary: false,
      verifiedAt: new Date(),
    });

    const wallets = await walletAddressRepository.findByUserId(userId);
    expect(wallets).toHaveLength(2);
    expect(wallets.filter((w) => w.isPrimary)).toHaveLength(1);
  });
});
