import { describe, expect, it } from 'vitest';
import { createListOpenDisputesUseCase } from './list-open-disputes.js';
import { buildDisputeReviewItem, createFakeDisputeReviewReader } from './__fixtures__/fakes.js';

describe('listOpenDisputes', () => {
  it('returns whatever the reader provides', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    disputeReviewReader.seed([buildDisputeReviewItem({ chainDeliveryId: 7n })]);
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    const result = await listOpenDisputes();

    expect(result).toEqual([buildDisputeReviewItem({ chainDeliveryId: 7n })]);
  });

  it('returns an empty array when nothing is open', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    await expect(listOpenDisputes()).resolves.toEqual([]);
  });
});
