import { describe, expect, it } from 'vitest';
import { createSyncEscrowFromEventUseCase } from './sync-escrow-from-event.js';
import {
  buildChainEscrowRecord,
  buildEscrow,
  buildEscrowEvent,
  createFakeEscrowContractReader,
  createInMemoryEscrowRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const escrowRepository = createInMemoryEscrowRepository();
  const contractReader = createFakeEscrowContractReader();
  const syncEscrowFromEvent = createSyncEscrowFromEventUseCase({
    escrowRepository,
    contractReader,
  });
  return { escrowRepository, contractReader, syncEscrowFromEvent };
}

describe('syncEscrowFromEvent', () => {
  it('ignores events from a different contract', async () => {
    const { escrowRepository, syncEscrowFromEvent } = setup();

    await syncEscrowFromEvent(buildEscrowEvent({ contractName: 'delivery' }));

    expect(await escrowRepository.findByChainDeliveryId(1n)).toBeNull();
  });

  it('reads the delivery id from topic[1], not the payload — escrow_contract puts it in the topic', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    contractReader.seed(
      99n,
      buildChainEscrowRecord({ chainDeliveryId: 99n, token: 'GSPECIFICTOKEN' }),
    );

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['escrow_funded', '99'],
        // The payload deliberately does NOT contain '99' anywhere, so a
        // handler that (incorrectly) tried to read the id from the payload
        // would fail to find delivery 99 at all.
        payload: ['GSENDER', 'GRECIPIENT', '1000000'],
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(99n);
    expect(stored?.token).toBe('GSPECIFICTOKEN');
  });

  it('escrow_funded: hydrates the full record via get_escrow (payload lacks driver/token)', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    contractReader.seed(
      1n,
      buildChainEscrowRecord({ chainDeliveryId: 1n, driverAddress: 'GDRIVERX', token: 'GTOKENX' }),
    );

    await syncEscrowFromEvent(buildEscrowEvent({ topic: ['escrow_funded', '1'] }));

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.driverAddress).toBe('GDRIVERX');
    expect(stored?.token).toBe('GTOKENX');
    expect(stored?.status).toBe('LOCKED');
  });

  it('escrow_released: sets status RELEASED, platformFee from the payload, releasedAt from ledger close time', async () => {
    const { escrowRepository, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'LOCKED' }));
    const closedAt = new Date('2026-01-01T00:00:00Z');

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['escrow_released', '1'],
        payload: ['GDRIVER', '950000', '50000'],
        closedAt,
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('RELEASED');
    expect(stored?.platformFee).toBe(50000n);
    expect(stored?.releasedAt).toEqual(closedAt);
  });

  it('escrow_refunded: sets status REFUNDED and refundedAt', async () => {
    const { escrowRepository, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'LOCKED' }));
    const closedAt = new Date('2026-01-02T00:00:00Z');

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['escrow_refunded', '1'],
        payload: ['GSENDER', '1000000'],
        closedAt,
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('REFUNDED');
    expect(stored?.refundedAt).toEqual(closedAt);
  });

  it('delivery_disputed: sets status PAUSED, disputedBy, disputedAt', async () => {
    const { escrowRepository, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'LOCKED' }));
    const closedAt = new Date('2026-01-03T00:00:00Z');

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['delivery_disputed', '1'],
        payload: ['GDISPUTER', '1700000000'],
        closedAt,
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('PAUSED');
    expect(stored?.disputedBy).toBe('GDISPUTER');
    expect(stored?.disputedAt).toEqual(closedAt);
  });

  it('dispute_resolved: resolves to RELEASED by consulting get_escrow (event alone is ambiguous)', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'PAUSED' }));
    contractReader.seed(1n, buildChainEscrowRecord({ chainDeliveryId: 1n, status: 'RELEASED' }));

    await syncEscrowFromEvent(
      buildEscrowEvent({ topic: ['dispute_resolved', '1'], payload: ['GADMIN', 'GADMIN'] }),
    );

    expect((await escrowRepository.findByChainDeliveryId(1n))?.status).toBe('RELEASED');
  });

  it('dispute_resolved: resolves to REFUNDED when that is what get_escrow reports', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'PAUSED' }));
    contractReader.seed(1n, buildChainEscrowRecord({ chainDeliveryId: 1n, status: 'REFUNDED' }));

    await syncEscrowFromEvent(
      buildEscrowEvent({ topic: ['dispute_resolved', '1'], payload: ['GADMIN', 'GADMIN'] }),
    );

    expect((await escrowRepository.findByChainDeliveryId(1n))?.status).toBe('REFUNDED');
  });

  it('ignores protocol-config events (no per-escrow row to update)', async () => {
    const { syncEscrowFromEvent } = setup();

    await expect(
      syncEscrowFromEvent(buildEscrowEvent({ topic: ['FeeUpdated', '1'] })),
    ).resolves.toBeUndefined();
  });

  it('ignores an event with a missing/malformed delivery id in the topic', async () => {
    const { syncEscrowFromEvent } = setup();

    await expect(
      syncEscrowFromEvent(buildEscrowEvent({ topic: ['escrow_funded'] })),
    ).resolves.toBeUndefined();
  });

  it('dispute_resolved: handles LOCKED status without silently doing nothing (issue #38)', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'PAUSED' }));
    contractReader.seed(1n, buildChainEscrowRecord({ chainDeliveryId: 1n, status: 'LOCKED' }));

    await syncEscrowFromEvent(
      buildEscrowEvent({ topic: ['dispute_resolved', '1'], payload: ['GADMIN', 'GADMIN'] }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('LOCKED');
  });

  it('dispute_resolved: backfills platformFee when dispute resolves to RELEASED (issue #39)', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 2n, status: 'PAUSED', platformFee: null }));
    contractReader.seed(2n, buildChainEscrowRecord({
      chainDeliveryId: 2n,
      status: 'RELEASED',
      platformFee: 75000n,
    }));
    const closedAt = new Date('2026-01-04T00:00:00Z');

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['dispute_resolved', '2'],
        payload: ['GADMIN', 'GADMIN'],
        closedAt,
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(2n);
    expect(stored?.status).toBe('RELEASED');
    expect(stored?.releasedAt).toEqual(closedAt);
  });
});
