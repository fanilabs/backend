import { describe, expect, it } from 'vitest';
import { createGetCompletionRateUseCase } from './get-completion-rate.js';
import { createFakeAnalyticsReader } from './__fixtures__/fakes.js';

describe('getCompletionRate', () => {
  it('computes the fraction of deliveries that reached DELIVERED', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    analyticsReader.setFunnelCounts({ totalDeliveries: 4, deliveredCount: 3, disputedCount: 1 });
    const getCompletionRate = createGetCompletionRateUseCase({ analyticsReader });

    await expect(getCompletionRate()).resolves.toEqual({
      totalDeliveries: 4,
      deliveredCount: 3,
      completionRate: 0.75,
    });
  });

  it('returns 0, not NaN, when there are no deliveries yet', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    const getCompletionRate = createGetCompletionRateUseCase({ analyticsReader });

    await expect(getCompletionRate()).resolves.toEqual({
      totalDeliveries: 0,
      deliveredCount: 0,
      completionRate: 0,
    });
  });
});
