import { describe, expect, it } from 'vitest';
import { createSyncDisputeFromEventUseCase } from './sync-dispute-from-event.js';
import {
  buildDispute,
  buildDisputeResolutionEvent,
  buildEscrowDisputeEvent,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const disputeRepository = createInMemoryDisputeRepository();
  const walletOwnershipRepository = createFakeWalletOwnershipRepository();
  // `escrowStateReader` is still not provided here (pre-existing, unrelated
  // to B2.1 — see the "escrow dispute_resolved is intentionally not
  // handled" test below, which already fails against this same gap).
  // `walletOwnershipRepository` is now required too (B2.1) — every test in
  // this file that reaches `dispute_raised`/`delivery_disputed` needs it,
  // not just the new ones added for this fix.
  const syncDisputeFromEvent = createSyncDisputeFromEventUseCase({
    disputeRepository,
    walletOwnershipRepository,
  });
  return { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent };
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

  it('dispute_resolved_split: drops an out-of-range senderShareBps instead of persisting it', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 3n, status: 'OPEN' }));

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_resolved_split', '["3"]'],
        payload: ['GADMIN', ['3'], 10_001],
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(3n);
    expect(stored?.status).toBe('SPLIT');
    expect(stored?.senderShareBps).toBeNull();
  });

  it('dispute_resolved_split: replaying the same event twice is idempotent', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(buildDispute({ chainDeliveryId: 4n, status: 'OPEN' }));
    const event = buildDisputeResolutionEvent({
      topic: ['dispute_resolved_split', '["4"]'],
      payload: ['GADMIN', ['4'], 2500],
    });

    await syncDisputeFromEvent(event);
    await syncDisputeFromEvent(event);

    const stored = await disputeRepository.findByChainDeliveryId(4n);
    expect(stored?.status).toBe('SPLIT');
    expect(stored?.senderShareBps).toBe(2500);
  });

  // ── raisedByUserId capture (B2.1: raiser wallet-relink evidence
  // authorization) ─────────────────────────────────────────────────────────

  it('dispute_raised: captures raisedByUserId from whoever currently owns the address, on first creation', async () => {
    const { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent } = setup();
    walletOwnershipRepository.seed('raiser-user', 'GRAISER5');

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_raised', '["5"]'],
        payload: ['GRAISER5', ['5']],
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(5n);
    expect(stored?.raisedBy).toBe('GRAISER5');
    expect(stored?.raisedByUserId).toBe('raiser-user');
  });

  it('dispute_raised: leaves raisedByUserId null when the address has no linked account', async () => {
    const { disputeRepository, syncDisputeFromEvent } = setup();

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_raised', '["6"]'],
        payload: ['GUNLINKED', ['6']],
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(6n);
    expect(stored?.raisedByUserId).toBeNull();
  });

  it('dispute_raised: replaying the event after the wallet was relinked to someone else does not reassign raisedByUserId', async () => {
    const { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent } = setup();
    walletOwnershipRepository.seed('original-raiser', 'GRAISER7');
    const event = buildDisputeResolutionEvent({
      topic: ['dispute_raised', '["7"]'],
      payload: ['GRAISER7', ['7']],
    });

    await syncDisputeFromEvent(event);
    // GRAISER7 is unlinked from original-raiser and relinked to a different
    // account before the (checkpointed/replayed) event is processed again —
    // the same fake Map, so seeding again simply overwrites the reverse
    // lookup, exactly like a real relink would in the wallet_addresses table.
    walletOwnershipRepository.seed('new-owner', 'GRAISER7');
    await syncDisputeFromEvent(event);

    const stored = await disputeRepository.findByChainDeliveryId(7n);
    expect(stored?.raisedByUserId).toBe('original-raiser');
  });

  it('dispute_raised: does not attribute raisedByUserId to a new owner when the event is first processed after a relink (indexer backlog)', async () => {
    const { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent } = setup();
    // The dispute was actually raised on-chain at t0, but our indexer had
    // fallen behind (a real, routine occurrence — poll-contract-events.ts
    // resumes from a checkpoint after any downtime) and only processes this
    // dispute_raised event for the FIRST time well after t0 — by which
    // point the original raiser's wallet has already been relinked to a
    // different account. This is not a replay of an existing row; no
    // Dispute row exists yet when this event is processed.
    const raisedAt = new Date('2026-01-01T00:00:00Z'); // t0: actual on-chain raise time
    walletOwnershipRepository.seed('new-owner', 'GRAISER10', new Date('2026-01-02T00:00:00Z')); // linked AFTER t0

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_raised', '["10"]'],
        payload: ['GRAISER10', ['10']],
        closedAt: raisedAt,
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(10n);
    expect(stored?.raisedBy).toBe('GRAISER10');
    // Must NOT be 'new-owner' — they had nothing to do with raising this
    // dispute, they just happened to be the address's current owner by the
    // time the backend got around to processing the event.
    expect(stored?.raisedByUserId).toBeNull();
  });

  it('dispute_raised: attributes raisedByUserId to the owner when their wallet link predates the on-chain raise', async () => {
    const { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent } = setup();
    const raisedAt = new Date('2026-01-02T00:00:00Z');
    // Linked well before the dispute was raised — the legitimate case.
    walletOwnershipRepository.seed('original-raiser', 'GRAISER11', new Date('2026-01-01T00:00:00Z'));

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_raised', '["11"]'],
        payload: ['GRAISER11', ['11']],
        closedAt: raisedAt,
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(11n);
    expect(stored?.raisedByUserId).toBe('original-raiser');
  });

  it('escrow delivery_disputed: also captures raisedByUserId on first creation (Layer A alone)', async () => {
    const { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent } = setup();
    walletOwnershipRepository.seed('layer-a-raiser', 'GDISPUTER8');

    await syncDisputeFromEvent(
      buildEscrowDisputeEvent({
        topic: ['delivery_disputed', '8'],
        payload: ['GDISPUTER8', '1700000000'],
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(8n);
    expect(stored?.raisedByUserId).toBe('layer-a-raiser');
  });

  it('a later resolution event never sets or touches raisedByUserId on an existing dispute', async () => {
    const { disputeRepository, walletOwnershipRepository, syncDisputeFromEvent } = setup();
    disputeRepository.seed(
      buildDispute({ chainDeliveryId: 9n, status: 'OPEN', raisedByUserId: 'original-raiser' }),
    );
    // Even if the raiser's wallet is now owned by someone else by the time
    // a resolution event arrives, resolving must never touch raisedByUserId.
    walletOwnershipRepository.seed('new-owner', 'GRAISER9');

    await syncDisputeFromEvent(
      buildDisputeResolutionEvent({
        topic: ['dispute_resolved_payout', '["9"]'],
        payload: ['GADMIN', ['9']],
      }),
    );

    const stored = await disputeRepository.findByChainDeliveryId(9n);
    expect(stored?.status).toBe('RESOLVED_PAYOUT');
    expect(stored?.raisedByUserId).toBe('original-raiser');
  });
});
