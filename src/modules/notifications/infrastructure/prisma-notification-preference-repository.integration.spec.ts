import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaNotificationPreferenceRepository } from './prisma-notification-preference-repository.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)(
  'Prisma notification preference repository (integration)',
  () => {
    const prisma = new PrismaClient();
    const repo = createPrismaNotificationPreferenceRepository(prisma);
    const createdUserIds: string[] = [];

    afterAll(async () => {
      if (createdUserIds.length > 0) {
        await prisma.notificationPreference.deleteMany({
          where: { userId: { in: createdUserIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      await prisma.$disconnect();
    });

    async function seedUser(): Promise<string> {
      const user = await prisma.user.create({
        data: {
          email: `pref-test-${randomUUID()}@example.com`,
          passwordHash: 'hash',
          role: 'CUSTOMER',
        },
      });
      createdUserIds.push(user.id);
      return user.id;
    }

    it('returns an empty list when the user has no preferences', async () => {
      const userId = await seedUser();
      expect(await repo.listByUserId(userId)).toEqual([]);
    });

    it('upsert creates a new preference row', async () => {
      const userId = await seedUser();

      const pref = await repo.upsert({
        userId,
        eventType: 'DELIVERY_DRIVER_ASSIGNED',
        disabled: true,
      });

      expect(pref).toMatchObject({
        userId,
        eventType: 'DELIVERY_DRIVER_ASSIGNED',
        disabled: true,
      });
      expect(pref.id).toBeDefined();
    });

    it('upsert updates an existing row without creating a duplicate', async () => {
      const userId = await seedUser();

      await repo.upsert({ userId, eventType: 'ESCROW_RELEASED', disabled: false });
      const updated = await repo.upsert({ userId, eventType: 'ESCROW_RELEASED', disabled: true });

      expect(updated.disabled).toBe(true);
      const all = await repo.listByUserId(userId);
      expect(all).toHaveLength(1);
    });

    it('listByUserId returns all preferences for the user and no other users', async () => {
      const userId = await seedUser();
      const otherId = await seedUser();

      await repo.upsert({ userId, eventType: 'DISPUTE_RAISED', disabled: true });
      await repo.upsert({ userId, eventType: 'FLEET_REGISTERED', disabled: false });
      await repo.upsert({ userId: otherId, eventType: 'DISPUTE_RAISED', disabled: true });

      const prefs = await repo.listByUserId(userId);
      expect(prefs).toHaveLength(2);
      expect(prefs.every((p) => p.userId === userId)).toBe(true);
    });

    it('isDisabled returns false when no preference row exists (default-enabled)', async () => {
      const userId = await seedUser();
      expect(await repo.isDisabled(userId, 'DELIVERY_DRIVER_ASSIGNED')).toBe(false);
    });

    it('isDisabled returns false when disabled is false', async () => {
      const userId = await seedUser();
      await repo.upsert({ userId, eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: false });
      expect(await repo.isDisabled(userId, 'DELIVERY_DRIVER_ASSIGNED')).toBe(false);
    });

    it('isDisabled returns true when disabled is true', async () => {
      const userId = await seedUser();
      await repo.upsert({ userId, eventType: 'DELIVERY_DRIVER_ASSIGNED', disabled: true });
      expect(await repo.isDisabled(userId, 'DELIVERY_DRIVER_ASSIGNED')).toBe(true);
    });

    it('isDisabled is scoped to the user — another user with the same event type is unaffected', async () => {
      const userId = await seedUser();
      const otherId = await seedUser();
      await repo.upsert({ userId, eventType: 'ESCROW_RELEASED', disabled: true });

      expect(await repo.isDisabled(otherId, 'ESCROW_RELEASED')).toBe(false);
    });
  },
);
