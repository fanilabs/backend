import type { AnalyticsReader, DriverTierCounts } from '../domain/index.js';

export interface GetDriverTierDistributionDeps {
  analyticsReader: AnalyticsReader;
}

export interface DriverTierDistributionResult extends DriverTierCounts {
  total: number;
}

/**
 * Creates the use case that computes the distribution of drivers across tiers.
 *
 * @param deps - Dependencies required by the use case.
 * @param deps.analyticsReader - Reader used to fetch the per-tier driver counts.
 * @returns An async function that takes no arguments and resolves with the
 * driver tier distribution, containing the `bronze`, `silver`, and `gold`
 * counts plus the aggregated `total`.
 */
export function createGetDriverTierDistributionUseCase(deps: GetDriverTierDistributionDeps) {
  return async function getDriverTierDistribution(): Promise<DriverTierDistributionResult> {
    const counts = await deps.analyticsReader.getDriverTierCounts();
    return { ...counts, total: counts.bronze + counts.silver + counts.gold };
  };
}
