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

  it('returns only the selected user rows ordered by createdAt with nullable verifiedAt preserved', async () => {
    const userId = await seedUser();
    const otherUserId = await seedUser();

    const earlier = new Date('2024-01-01T00:00:00.000Z');
    const later = new Date('2024-06-01T00:00:00.000Z');
    const verifiedAt = new Date('2024-03-15T12:34:56.000Z');

    const addressEarlier = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const addressLater = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const addressOther = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;

    // Insert the later row first so ordering cannot be satisfied by insertion order.
    const laterWallet = await walletAddressRepository.create({
      userId,
      address: addressLater,
      isPrimary: false,
      verifiedAt,
    });
    const earlierWallet = await walletAddressRepository.create({
      userId,
      address: addressEarlier,
      isPrimary: true,
      verifiedAt: null,
    });
    await walletAddressRepository.create({
      userId: otherUserId,
      address: addressOther,
      isPrimary: true,
      verifiedAt: null,
    });

    await prisma.walletAddress.update({
      where: { id: laterWallet.id },
      data: { createdAt: later },
    });
    await prisma.walletAddress.update({
      where: { id: earlierWallet.id },
      data: { createdAt: earlier },
    });

    const rows = await walletAddressRepository.findByUserId(userId);

    expect(rows.map((row) => row.id)).toEqual([earlierWallet.id, laterWallet.id]);
    expect(rows.map((row) => row.address)).toEqual([addressEarlier, addressLater]);
    expect(rows.map((row) => row.isPrimary)).toEqual([true, false]);
    expect(rows[0].verifiedAt).toBeNull();
    expect(rows[1].verifiedAt).toEqual(verifiedAt);
    expect(rows.some((row) => row.address === addressOther)).toBe(false);
  });

  it('promotes a wallet to primary and demotes previously primary wallet atomically', async () => {
    const userId = await seedUser();
    const address1 = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const address2 = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;

    const wallet1 = await walletAddressRepository.create({
      userId,
      address: address1,
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const wallet2 = await walletAddressRepository.create({
      userId,
      address: address2,
      isPrimary: false,
      verifiedAt: new Date(),
    });

    const promoted = await walletAddressRepository.setPrimary(userId, wallet2.id);
    expect(promoted.isPrimary).toBe(true);

    const refetched1 = await walletAddressRepository.findById(wallet1.id);
    const refetched2 = await walletAddressRepository.findById(wallet2.id);

    expect(refetched1?.isPrimary).toBe(false);
    expect(refetched2?.isPrimary).toBe(true);
  });

  it('database constraint prevents two primary wallets for the same user', async () => {
    const userId = await seedUser();
    const address1 = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;
    const address2 = `G${randomUUID().replace(/-/g, '').toUpperCase()}`;

    await walletAddressRepository.create({
      userId,
      address: address1,
      isPrimary: true,
      verifiedAt: new Date(),
    });

    // Attempting to insert a second is_primary = true for the same user must violate
    // the partial unique index `wallet_addresses_user_id_primary_key`.
    await expect(
      walletAddressRepository.create({
        userId,
        address: address2,
        isPrimary: true,
        verifiedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
