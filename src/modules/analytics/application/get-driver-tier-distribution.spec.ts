import { describe, expect, it } from 'vitest';
import { createGetDriverTierDistributionUseCase } from './get-driver-tier-distribution.js';
import { createFakeAnalyticsReader } from './__fixtures__/fakes.js';

describe('getDriverTierDistribution', () => {
  it('returns per-tier counts plus a total', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    analyticsReader.setTierCounts({ bronze: 5, silver: 3, gold: 2 });
    const getDriverTierDistribution = createGetDriverTierDistributionUseCase({ analyticsReader });

    await expect(getDriverTierDistribution()).resolves.toEqual({
      bronze: 5,
      silver: 3,
      gold: 2,
      total: 10,
    });
  });

  it('returns all zeros when no drivers are registered yet', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    const getDriverTierDistribution = createGetDriverTierDistributionUseCase({ analyticsReader });

    await expect(getDriverTierDistribution()).resolves.toEqual({
      bronze: 0,
      silver: 0,
      gold: 0,
      total: 0,
    });
  });
});
