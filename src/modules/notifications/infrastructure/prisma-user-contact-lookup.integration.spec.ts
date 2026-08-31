import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaUserContactLookup } from './prisma-user-contact-lookup.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)('Prisma user contact lookup (integration)', () => {
  const prisma = new PrismaClient();
  const userContactLookup = createPrismaUserContactLookup(prisma);
  const createdUserIds: string[] = [];

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.walletAddress.deleteMany({ where: { userId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  it('resolves a linked wallet address to its owning user', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const address = Keypair.random().publicKey();
    const user = await prisma.user.create({
      data: { email, passwordHash: 'hash', role: 'CUSTOMER' },
    });
    createdUserIds.push(user.id);
    await prisma.walletAddress.create({
      data: { userId: user.id, address, isPrimary: true, verifiedAt: new Date() },
    });

    expect(await userContactLookup.findByWalletAddress(address)).toEqual({
      userId: user.id,
      email,
    });
    expect(await userContactLookup.findByWalletAddress(Keypair.random().publicKey())).toBeNull();
  });

  it('resolves a user by id', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: 'hash', role: 'CUSTOMER' },
    });
    createdUserIds.push(user.id);

    expect(await userContactLookup.findByUserId(user.id)).toEqual({ userId: user.id, email });
    expect(await userContactLookup.findByUserId(randomUUID())).toBeNull();
  });
});
