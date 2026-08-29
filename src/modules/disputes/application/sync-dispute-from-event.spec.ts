import { describe, expect, it } from 'vitest';
import { createSyncDisputeFromEventUseCase } from './sync-dispute-from-event.js';
import {
  buildDispute,
  buildDisputeResolutionEvent,
  buildEscrowDisputeEvent,
  createInMemoryDisputeRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const disputeRepository = createInMemoryDisputeRepository();
  const syncDisputeFromEvent = createSyncDisputeFromEventUseCase({ disputeRepository });
  return { disputeRepository, syncDisputeFromEvent };
}

describe('syncDisputeFromEvent', () => {
  it('ignores events from a contract it does not track', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();

    await syncDisputeFromEvent(buildDisputeResolutionEvent({ contractName: 'delivery' }));

    expect(await disputeRepository.findByChainDeliveryId(1n)).toBeNull();
  });

  it('dispute_raised: unwraps the tuple-wrapped DeliveryId from topic[1] and creates an OPEN dispute', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    const closedAt = new Date('2026-01-05T00:00:00Z');

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_raised', '["42"]'],
        payload: ['GRAISER', ['42']],
        closedAt,
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(42n);
    expect(stored).toMatchObject({ status: 'OPEN', raisedBy: 'GRAISER', raisedAt: closedAt });
  });

  it('ignores dispute_raised when topic[1] is not a one-element tuple (bare u64, wrong convention)', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({ topic: ['dispute_raised', '42'], payload: ['GRAISER', '42'] }),
    );

    expect(await disputeRepository.findByChainDeliveryId(42n)).toBeNull();
  });

  it('evidence_added: no-op — evidence rows are written by uploadEvidence, not the sync path', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['evidence_added', '["1"]'],
        payload: ['GSENDER', ['1'], 'aabbcc'],
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('OPEN');
  });

  it('dispute_resolved_refund: sets status RESOLVED_REFUND, resolvedBy, resolvedAt', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(
      buildDispute({ chainDeliveryId: 1n, status: 'OPEN', raisedBy: 'GRAISER' }),
    );
    const resolvedAt = new Date('2026-02-01T00:00:00Z');

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_resolved_refund', '["1"]'],
        payload: ['GADMIN', ['1'], 'GDRIVER', 10],
        closedAt: resolvedAt,
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(1n);
    expect(stored).toMatchObject({
      status: 'RESOLVED_REFUND',
      resolvedBy: 'GADMIN',
      resolvedAt,
      raisedBy: 'GRAISER',
    });
  });

  it('dispute_resolved_split: sets status SPLIT', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_resolved_split', '["1"]'],
        payload: ['GADMIN', ['1']],
      }),
    );

    expect((await disputeRepository.findByChainDeliveryId(1n))?.status).toBe('SPLIT');
  });

  it('dispute_resolved_payout: sets status RESOLVED_PAYOUT', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_resolved_payout', '["1"]'],
        payload: ['GADMIN', ['1']],
      }),
    );

    expect((await disputeRepository.findByChainDeliveryId(1n))?.status).toBe('RESOLVED_PAYOUT');
  });

  it('escrow delivery_disputed: creates an OPEN dispute from Layer A alone (bare u64 topic, no tuple)', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    const closedAt = new Date('2026-01-10T00:00:00Z');

    await syncDisputeFromEvent(
      buildEscrowDisputeEvent({ topic: ['delivery_disputed', '7'], closedAt }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(7n);
    expect(stored).toMatchObject({ status: 'OPEN', raisedBy: 'GDISPUTER', raisedAt: closedAt });
  });

  it('escrow dispute_resolved is intentionally not handled — ambiguous outcome, no fallback read here', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 1n, status: 'OPEN' }));

    await syncDisputeFromEvent(
      buildEscrowDisputeEvent({ topic: ['dispute_resolved', '1'], payload: ['GADMIN', 'GADMIN'] }),
    );

    expect((await disputeRepository.findByChainDeliveryId(1n))?.status).toBe('OPEN');
  });

  it('dispute_resolved_split: records senderShareBps from the event payload (issue #40)', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 2n, status: 'OPEN' }));
    const resolvedAt = new Date('2026-03-01T00:00:00Z');

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_resolved_split', '["2"]'],
        payload: ['GADMIN', ['2'], 7500],
        closedAt: resolvedAt,
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(2n);
    expect(stored?.status).toBe('SPLIT');
    expect(stored?.senderShareBps).toBe(7500);
  });
});
