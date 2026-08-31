import { describe, expect, it } from 'vitest';
import { createGetDisputeRateUseCase } from './get-dispute-rate.js';
import { createFakeAnalyticsReader } from './__fixtures__/fakes.js';

describe('getDisputeRate', () => {
  it('computes the fraction of deliveries that were ever disputed', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    analyticsReader.setFunnelCounts({ totalDeliveries: 10, deliveredCount: 8, disputedCount: 2 });
    const getDisputeRate = createGetDisputeRateUseCase({ analyticsReader });

    await expect(getDisputeRate()).resolves.toEqual({
      totalDeliveries: 10,
      disputedCount: 2,
      disputeRate: 0.2,
    });
  });

  it('returns 0, not NaN, when there are no deliveries yet', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    const getDisputeRate = createGetDisputeRateUseCase({ analyticsReader });

    await expect(getDisputeRate()).resolves.toEqual({
      totalDeliveries: 0,
      disputedCount: 0,
      disputeRate: 0,
    });
  });
});
