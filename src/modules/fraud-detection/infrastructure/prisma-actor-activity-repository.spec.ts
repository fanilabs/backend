import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPrismaActorActivityRepository,
  DEFAULT_CLEANUP_MAX_ITERATIONS,
} from './prisma-actor-activity-repository.js';

describe('PrismaActorActivityRepository - deleteOlderThan (issue #469)', () => {
  let mockPrisma: {
    actorActivity: {
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      actorActivity: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
  });

  it('terminates loop when maxIterations limit is reached, avoiding unbounded execution', async () => {
    const repository = createPrismaActorActivityRepository(mockPrisma as unknown as PrismaClient);
    const cutoff = new Date('2026-10-01T00:00:00Z');
    const batchSize = 100;
    const maxIterations = 3;

    mockPrisma.actorActivity.findMany.mockResolvedValue(
      Array.from({ length: batchSize }, (_, i) => ({ id: `id-${i}` })),
    );
    mockPrisma.actorActivity.deleteMany.mockResolvedValue({ count: batchSize });

    const totalDeleted = await repository.deleteOlderThan(cutoff, batchSize, maxIterations);

    expect(totalDeleted).toBe(batchSize * maxIterations);
    expect(mockPrisma.actorActivity.findMany).toHaveBeenCalledTimes(maxIterations);
    expect(mockPrisma.actorActivity.deleteMany).toHaveBeenCalledTimes(maxIterations);
  });

  it('defaults maxIterations to 50 when omitted in batched mode', async () => {
    const repository = createPrismaActorActivityRepository(mockPrisma as unknown as PrismaClient);
    const cutoff = new Date('2026-10-01T00:00:00Z');
    const batchSize = 10;

    mockPrisma.actorActivity.findMany.mockResolvedValue(
      Array.from({ length: batchSize }, (_, i) => ({ id: `id-${i}` })),
    );
    mockPrisma.actorActivity.deleteMany.mockResolvedValue({ count: batchSize });

    const totalDeleted = await repository.deleteOlderThan(cutoff, batchSize);

    expect(mockPrisma.actorActivity.findMany).toHaveBeenCalledTimes(DEFAULT_CLEANUP_MAX_ITERATIONS);
    expect(totalDeleted).toBe(batchSize * DEFAULT_CLEANUP_MAX_ITERATIONS);
  });

  it('stops early when a batch returns empty', async () => {
    const repository = createPrismaActorActivityRepository(mockPrisma as unknown as PrismaClient);
    const cutoff = new Date('2026-10-01T00:00:00Z');

    mockPrisma.actorActivity.findMany.mockResolvedValue([]);

    const totalDeleted = await repository.deleteOlderThan(cutoff, 100, 50);

    expect(totalDeleted).toBe(0);
    expect(mockPrisma.actorActivity.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.actorActivity.deleteMany).not.toHaveBeenCalled();
  });

  it('stops early when batch is smaller than batchSize', async () => {
    const repository = createPrismaActorActivityRepository(mockPrisma as unknown as PrismaClient);
    const cutoff = new Date('2026-10-01T00:00:00Z');
    const batchSize = 50;
    const partialBatch = [{ id: '1' }, { id: '2' }, { id: '3' }];

    mockPrisma.actorActivity.findMany.mockResolvedValue(partialBatch);
    mockPrisma.actorActivity.deleteMany.mockResolvedValue({ count: partialBatch.length });

    const totalDeleted = await repository.deleteOlderThan(cutoff, batchSize, 10);

    expect(totalDeleted).toBe(3);
    expect(mockPrisma.actorActivity.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.actorActivity.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('runs direct unbatched deleteMany when batchSize is undefined', async () => {
    const repository = createPrismaActorActivityRepository(mockPrisma as unknown as PrismaClient);
    const cutoff = new Date('2026-10-01T00:00:00Z');

    mockPrisma.actorActivity.deleteMany.mockResolvedValue({ count: 15 });

    const totalDeleted = await repository.deleteOlderThan(cutoff);

    expect(totalDeleted).toBe(15);
    expect(mockPrisma.actorActivity.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.actorActivity.deleteMany).toHaveBeenCalledWith({
      where: { occurredAt: { lt: cutoff } },
    });
  });
});
