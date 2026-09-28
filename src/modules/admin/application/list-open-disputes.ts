import type { DisputeReviewItem, DisputeReviewReader } from '../domain/index.js';

export interface ListOpenDisputesDeps {
  disputeReviewReader: DisputeReviewReader;
}

/**
 * Creates the use case for listing disputes that are awaiting administrative
 * review.
 *
 * @param deps - Use case dependencies; requires a `disputeReviewReader` used
 *   to retrieve the currently open disputes.
 * @returns An async function that resolves to the open dispute review items.
 */
export function createListOpenDisputesUseCase(deps: ListOpenDisputesDeps) {
  return async function listOpenDisputes(
    input: ListOpenDisputesInput = {},
  ): Promise<ListOpenDisputesResult> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const page = await deps.disputeReviewReader.listOpenDisputes({
      limit,
      ...(input.after && { after: decodeCursor(input.after) }),
    });
    const hasMore = page.length > limit;
    const items = page.slice(0, limit);
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem
        ? `${lastItem.raisedAt.toISOString()}|${lastItem.chainDeliveryId.toString()}`
        : null;

    return { items, nextCursor, limit };
  };
}
