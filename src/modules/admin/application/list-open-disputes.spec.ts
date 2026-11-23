import { describe, expect, it } from 'vitest';
import { createListOpenDisputesUseCase } from './list-open-disputes.js';
import { buildDisputeReviewItem, createFakeDisputeReviewReader } from './__fixtures__/fakes.js';

describe('listOpenDisputes', () => {
  it('returns a full terminal page without a next cursor', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    const first = buildDisputeReviewItem({ chainDeliveryId: 7n });
    const second = buildDisputeReviewItem({
      chainDeliveryId: 8n,
      raisedAt: new Date('2026-01-02T00:00:00Z'),
    });
    disputeReviewReader.seed([first, second]);
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    await expect(listOpenDisputes({ limit: 2 })).resolves.toEqual({
      items: [first, second],
      nextCursor: null,
      limit: 2,
    });
  });

  it('uses the last returned item for the cursor and excludes the lookahead row', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    const first = buildDisputeReviewItem({ chainDeliveryId: 7n });
    const second = buildDisputeReviewItem({
      chainDeliveryId: 8n,
      raisedAt: new Date('2026-01-02T00:00:00Z'),
    });
    const lookahead = buildDisputeReviewItem({
      chainDeliveryId: 9n,
      raisedAt: new Date('2026-01-03T00:00:00Z'),
    });
    disputeReviewReader.seed([first, second, lookahead]);
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    const result = await listOpenDisputes({ limit: 2 });

    expect(result).toEqual({
      items: [first, second],
      nextCursor: '2026-01-02T00:00:00.000Z|8',
      limit: 2,
    });
  });

  it('returns an empty array when nothing is open', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    await expect(listOpenDisputes()).resolves.toEqual({
      items: [],
      nextCursor: null,
      limit: 50,
    });
  });

  it('continues after a cursor with matching timestamps', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    const first = buildDisputeReviewItem({ chainDeliveryId: 7n });
    const second = buildDisputeReviewItem({
      chainDeliveryId: 8n,
      raisedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const third = buildDisputeReviewItem({
      chainDeliveryId: 9n,
      raisedAt: new Date('2026-01-02T00:00:00Z'),
    });
    disputeReviewReader.seed([first, second, third]);
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    const result = await listOpenDisputes({ after: '2026-01-01T00:00:00.000Z|8' });

    expect(result).toEqual({ items: [third], nextCursor: null, limit: 50 });
  });

  it('caps the page size and returns a cursor when more results exist', async () => {
    const disputeReviewReader = createFakeDisputeReviewReader();
    disputeReviewReader.seed(
      Array.from({ length: 202 }, (_, index) =>
        buildDisputeReviewItem({
          chainDeliveryId: BigInt(index + 1),
          raisedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
        }),
      ),
    );
    const listOpenDisputes = createListOpenDisputesUseCase({ disputeReviewReader });

    const result = await listOpenDisputes({ limit: 500 });

    expect(result.items).toHaveLength(200);
    expect(result.limit).toBe(200);
    expect(result.nextCursor).toBe('2026-01-01T00:03:19.000Z|200');
  });

  it('rejects malformed cursors', async () => {
    const listOpenDisputes = createListOpenDisputesUseCase({
      disputeReviewReader: createFakeDisputeReviewReader(),
    });

    await expect(listOpenDisputes({ after: 'not-a-cursor' })).rejects.toThrow(
      'Invalid dispute cursor',
    );
  });
});
