import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createPrismaActorActivityRepository } from './prisma-actor-activity-repository';

describe('createPrismaActorActivityRepository', () => {
  describe('deleteOlderThan', () => {
    it('stops after maxIterations even when batches remain full', async () => {
      const findMany = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
      const prisma = {
        actorActivity: { findMany, deleteMany },
      } as unknown as PrismaClient;

      const repository = createPrismaActorActivityRepository(prisma);
      const olderThan = new Date('2024-01-01T00:00:00.000Z');

      const totalDeleted = await repository.deleteOlderThan(olderThan, 2, 3);

      expect(totalDeleted).toBe(6);
      expect(findMany).toHaveBeenCalledTimes(3);
      expect(deleteMany).toHaveBeenCalledTimes(3);
    });

    it('defaults to 50 iterations when no cap is provided', async () => {
      const findMany = vi.fn().mockResolvedValue([{ id: 'a' }]);
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        actorActivity: { findMany, deleteMany },
      } as unknown as PrismaClient;

      const repository = createPrismaActorActivityRepository(prisma);
      const olderThan = new Date('2024-01-01T00:00:00.000Z');

      const totalDeleted = await repository.deleteOlderThan(olderThan, 1);

      expect(totalDeleted).toBe(50);
      expect(findMany).toHaveBeenCalledTimes(50);
    });

    it('exits early when a batch is empty', async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
      const prisma = {
        actorActivity: { findMany, deleteMany },
      } as unknown as PrismaClient;

      const repository = createPrismaActorActivityRepository(prisma);
      const olderThan = new Date('2024-01-01T00:00:00.000Z');

      const totalDeleted = await repository.deleteOlderThan(olderThan, 1000);

      expect(totalDeleted).toBe(0);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('exits early when a batch is smaller than batchSize', async () => {
      const findMany = vi.fn().mockResolvedValue([{ id: 'a' }]);
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const prisma = {
        actorActivity: { findMany, deleteMany },
      } as unknown as PrismaClient;

      const repository = createPrismaActorActivityRepository(prisma);
      const olderThan = new Date('2024-01-01T00:00:00.000Z');

      const totalDeleted = await repository.deleteOlderThan(olderThan, 1000);

      expect(totalDeleted).toBe(1);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(deleteMany).toHaveBeenCalledTimes(1);
    });
  });
});
