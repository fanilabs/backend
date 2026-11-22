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

  it('observes updated email addresses on later reads via the same adapter', async () => {
    const originalEmail = `test-${randomUUID()}@example.com`;
    const replacementEmail = `test-${randomUUID()}@example.com`;
    const otherEmail = `test-${randomUUID()}@example.com`;
    const address = Keypair.random().publicKey();

    const user = await prisma.user.create({
      data: { email: originalEmail, passwordHash: 'hash', role: 'CUSTOMER' },
    });
    createdUserIds.push(user.id);
    await prisma.walletAddress.create({
      data: { userId: user.id, address, isPrimary: true, verifiedAt: new Date() },
    });

    const otherUser = await prisma.user.create({
      data: { email: otherEmail, passwordHash: 'hash', role: 'CUSTOMER' },
    });
    createdUserIds.push(otherUser.id);

    expect(await userContactLookup.findByUserId(user.id)).toEqual({
      userId: user.id,
      email: originalEmail,
    });
    expect(await userContactLookup.findByWalletAddress(address)).toEqual({
      userId: user.id,
      email: originalEmail,
    });

    await prisma.user.update({ where: { id: user.id }, data: { email: replacementEmail } });

    const byId = await userContactLookup.findByUserId(user.id);
    expect(byId).toEqual({ userId: user.id, email: replacementEmail });
    expect(byId?.userId).toBe(user.id);

    const byWallet = await userContactLookup.findByWalletAddress(address);
    expect(byWallet).toEqual({ userId: user.id, email: replacementEmail });
    expect(byWallet?.userId).toBe(user.id);

    expect(await userContactLookup.findByUserId(otherUser.id)).toEqual({
      userId: otherUser.id,
      email: otherEmail,
    });
  });
});
