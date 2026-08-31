import type { AnalyticsReader } from '../domain/index.js';

export interface GetCompletionRateDeps {
  analyticsReader: AnalyticsReader;
}

export interface CompletionRateResult {
  totalDeliveries: number;
  deliveredCount: number;
  /** Fraction in [0, 1], not a percentage — `0` when there are no
   * deliveries yet rather than `NaN` from a 0/0 division. */
  completionRate: number;
}

export function createGetCompletionRateUseCase(deps: GetCompletionRateDeps) {
  return async function getCompletionRate(): Promise<CompletionRateResult> {
    const { totalDeliveries, deliveredCount } =
      await deps.analyticsReader.getDeliveryFunnelCounts();
    return {
      totalDeliveries,
      deliveredCount,
      completionRate: totalDeliveries === 0 ? 0 : deliveredCount / totalDeliveries,
    };
  };
}
