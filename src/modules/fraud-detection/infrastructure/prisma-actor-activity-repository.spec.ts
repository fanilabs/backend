import { describe, expect, it, vi } from 'vitest';
import { createPrismaActorActivityRepository } from './prisma-actor-activity-repository.js';

describe('createPrismaActorActivityRepository.deleteOlderThan (#469)', () => {
  it('stops after maxIterations even when full batches remain', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const repo = createPrismaActorActivityRepository({
      actorActivity: { findMany, deleteMany },
    } as never);

    const total = await repo.deleteOlderThan(new Date('2026-01-01T00:00:00Z'), 2, 3);
    expect(total).toBe(6);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(deleteMany).toHaveBeenCalledTimes(3);
  });
});
