import type { AnalyticsReader, GmvByToken } from '../domain/index.js';

export interface GetGmvDeps {
  analyticsReader: AnalyticsReader;
}

/** Grouped by token, never summed across tokens — different Soroban tokens
 * are different units of value, and silently adding them together would
 * produce a meaningless number. */
export function createGetGmvUseCase(deps: GetGmvDeps) {
  return async function getGmv(): Promise<GmvByToken[]> {
    return deps.analyticsReader.getGmvByToken();
  };
}
