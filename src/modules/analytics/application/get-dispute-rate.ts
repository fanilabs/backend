import type { AnalyticsReader } from '../domain/index.js';

export interface GetDisputeRateDeps {
  analyticsReader: AnalyticsReader;
}

export interface DisputeRateResult {
  totalDeliveries: number;
  disputedCount: number;
  /** Fraction in [0, 1], not a percentage — `0` when there are no
   * deliveries yet rather than `NaN` from a 0/0 division. Counts every
   * delivery that was *ever* disputed (one `disputes` row per
   * `chainDeliveryId`), not deliveries currently sitting in `DISPUTED`
   * status — a resolved dispute moves the delivery on to `DELIVERED` or
   * `CANCELLED` (`DATABASE.md`), so a status-snapshot count would
   * undercount. */
  disputeRate: number;
}

export function createGetDisputeRateUseCase(deps: GetDisputeRateDeps) {
  return async function getDisputeRate(): Promise<DisputeRateResult> {
    const { totalDeliveries, disputedCount } = await deps.analyticsReader.getDeliveryFunnelCounts();
    return {
      totalDeliveries,
      disputedCount,
      disputeRate: totalDeliveries === 0 ? 0 : disputedCount / totalDeliveries,
    };
  };
}
