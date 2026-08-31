import { describe, expect, it } from 'vitest';
import { createGetGmvUseCase } from './get-gmv.js';
import { createFakeAnalyticsReader } from './__fixtures__/fakes.js';

describe('getGmv', () => {
  it('returns the per-token breakdown as-is, never summed across tokens', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    analyticsReader.setGmv([
      { token: 'USDC', releasedAmount: 1_000_000n, releasedCount: 3 },
      { token: 'XLM', releasedAmount: 500n, releasedCount: 1 },
    ]);
    const getGmv = createGetGmvUseCase({ analyticsReader });

    await expect(getGmv()).resolves.toEqual([
      { token: 'USDC', releasedAmount: 1_000_000n, releasedCount: 3 },
      { token: 'XLM', releasedAmount: 500n, releasedCount: 1 },
    ]);
  });

  it('returns an empty array when nothing has been released yet', async () => {
    const analyticsReader = createFakeAnalyticsReader();
    const getGmv = createGetGmvUseCase({ analyticsReader });

    await expect(getGmv()).resolves.toEqual([]);
  });
});
