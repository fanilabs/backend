import type { AnalyticsReader, DriverTierCounts } from '../domain/index.js';

export interface GetDriverTierDistributionDeps {
  analyticsReader: AnalyticsReader;
}

export interface DriverTierDistributionResult extends DriverTierCounts {
  total: number;
}

export function createGetDriverTierDistributionUseCase(deps: GetDriverTierDistributionDeps) {
  return async function getDriverTierDistribution(): Promise<DriverTierDistributionResult> {
    const counts = await deps.analyticsReader.getDriverTierCounts();
    return { ...counts, total: counts.bronze + counts.silver + counts.gold };
  };
}
