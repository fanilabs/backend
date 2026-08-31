import type { DisputeReviewItem, DisputeReviewReader } from '../domain/index.js';

export interface ListOpenDisputesDeps {
  disputeReviewReader: DisputeReviewReader;
}

export function createListOpenDisputesUseCase(deps: ListOpenDisputesDeps) {
  return async function listOpenDisputes(): Promise<DisputeReviewItem[]> {
    return deps.disputeReviewReader.listOpenDisputes();
  };
}
