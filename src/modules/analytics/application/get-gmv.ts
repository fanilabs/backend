import type { AnalyticsReader, GmvByToken } from '../domain/index.js';

export interface GetGmvDeps {
  analyticsReader: AnalyticsReader;
}

/** Grouped by token, never summed across tokens — different Soroban tokens
 * are different units of value, and silently adding them together would
 * produce a meaningless number. */
/**
* Creates the use case that returns gross merchandise value grouped by token.
*
* @param deps - Dependencies required by the use case.
* @param deps.analyticsReader - Reader used to fetch GMV grouped by token.
* @returns An async function that takes no arguments and resolves with GMV
* grouped by token.
*/
export function createGetGmvUseCase(deps: GetGmvDeps) {
  return async function getGmv(): Promise<GmvByToken[]> {
    return deps.analyticsReader.getGmvByToken();
  };
}
