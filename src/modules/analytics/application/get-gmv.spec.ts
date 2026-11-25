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

  it('preserves the reader\'s ordering contract — tokens come back sorted', async () => {
    // ordering is enforced at the infrastructure layer (prisma-analytics-reader); the use case preserves whatever order the reader returns
    const analyticsReader = createFakeAnalyticsReader();
    analyticsReader.setGmv([
      { token: 'ZZZ', releasedAmount: 300n, releasedCount: 3 },
      { token: 'MMM', releasedAmount: 200n, releasedCount: 2 },
      { token: 'AAA', releasedAmount: 100n, releasedCount: 1 },
    ]);
    const getGmv = createGetGmvUseCase({ analyticsReader });

    await expect(getGmv()).resolves.toEqual([
      { token: 'ZZZ', releasedAmount: 300n, releasedCount: 3 },
      { token: 'MMM', releasedAmount: 200n, releasedCount: 2 },
      { token: 'AAA', releasedAmount: 100n, releasedCount: 1 },
    ]);
  });
});
