import { describe, expect, it } from 'vitest';
import { testAddress } from '../../../shared/testing/addresses.js';
import { createSyncEscrowFromEventUseCase, parseAmount } from './sync-escrow-from-event.js';
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
        payload: [testAddress('sender'), testAddress('recipient'), '1000000'],
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
        payload: [testAddress('driver'), '950000', '50000'],
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
        payload: [testAddress('sender'), '1000000'],
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
        payload: [testAddress('disputer'), '1700000000'],
        closedAt,
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('PAUSED');
    expect(stored?.disputedBy).toBe(testAddress('disputer'));
    expect(stored?.disputedAt).toEqual(closedAt);
  });

  it('dispute_resolved: resolves to RELEASED by consulting get_escrow (event alone is ambiguous)', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'PAUSED' }));
    contractReader.seed(1n, buildChainEscrowRecord({ chainDeliveryId: 1n, status: 'RELEASED' }));

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['dispute_resolved', '1'],
        payload: [testAddress('admin'), testAddress('admin')],
      }),
    );

    expect((await escrowRepository.findByChainDeliveryId(1n))?.status).toBe('RELEASED');
  });

  it('dispute_resolved: resolves to REFUNDED when that is what get_escrow reports', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'PAUSED' }));
    contractReader.seed(1n, buildChainEscrowRecord({ chainDeliveryId: 1n, status: 'REFUNDED' }));

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['dispute_resolved', '1'],
        payload: [testAddress('admin'), testAddress('admin')],
      }),
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
      buildEscrowEvent({
        topic: ['dispute_resolved', '1'],
        payload: [testAddress('admin'), testAddress('admin')],
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('LOCKED');
  });

  it('dispute_resolved: replaying the same LOCKED-outcome event twice is idempotent', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 1n, status: 'PAUSED' }));
    contractReader.seed(1n, buildChainEscrowRecord({ chainDeliveryId: 1n, status: 'LOCKED' }));
    const event = buildEscrowEvent({
      topic: ['dispute_resolved', '1'],
      payload: [testAddress('admin'), testAddress('admin')],
    });

    await syncEscrowFromEvent(event);
    await syncEscrowFromEvent(event);

    const stored = await escrowRepository.findByChainDeliveryId(1n);
    expect(stored?.status).toBe('LOCKED');
  });

  it('dispute_resolved: stamps releasedAt from ledger close time when the escrow was released (issue #39)', async () => {
    const { escrowRepository, contractReader, syncEscrowFromEvent } = setup();
    escrowRepository.seed(
      buildEscrow({ chainDeliveryId: 2n, status: 'PAUSED', platformFee: null }),
    );
    // `buildChainEscrowRecord` is the on-chain `EscrowRecord` shape, which
    // deliberately has no `platformFee` field — the fee is only observable
    // from the `escrow_released` event payload (see the test above), never
    // from a `get_escrow` read (#337).
    contractReader.seed(2n, buildChainEscrowRecord({ chainDeliveryId: 2n, status: 'RELEASED' }));
    const closedAt = new Date('2026-01-04T00:00:00Z');

    await syncEscrowFromEvent(
      buildEscrowEvent({
        topic: ['dispute_resolved', '2'],
        payload: [testAddress('admin'), testAddress('admin')],
        closedAt,
      }),
    );

    const stored = await escrowRepository.findByChainDeliveryId(2n);
    expect(stored?.status).toBe('RELEASED');
    expect(stored?.releasedAt).toEqual(closedAt);
  });

  it('escrow_funded: creates escrow as verified when token is on the configured allowlist', async () => {
    const escrowRepository = createInMemoryEscrowRepository();
    const contractReader = createFakeEscrowContractReader();
    const usdcToken = 'CUSDC_OFFICIAL_ADDRESS_EXAMPLE';
    const syncEscrowFromEvent = createSyncEscrowFromEventUseCase({
      escrowRepository,
      contractReader,
      allowedTokens: [usdcToken],
    });

    contractReader.seed(
      10n,
      buildChainEscrowRecord({ chainDeliveryId: 10n, token: usdcToken }),
    );

    await syncEscrowFromEvent(buildEscrowEvent({ topic: ['escrow_funded', '10'] }));

    const stored = await escrowRepository.findByChainDeliveryId(10n);
    expect(stored).not.toBeNull();
    expect(stored?.token).toBe(usdcToken);
    expect(stored?.isVerified).toBe(true);
  });

  it('escrow_funded: flags escrow as isVerified: false and logs warning when token is not on allowlist', async () => {
    const escrowRepository = createInMemoryEscrowRepository();
    const contractReader = createFakeEscrowContractReader();
    const allowedToken = 'CUSDC_OFFICIAL_ADDRESS_EXAMPLE';
    const rogueToken = 'CROGUE_TOKEN_MALICIOUS_ADDRESS';
    const warnLogs: unknown[] = [];
    const fakeLogger = {
      warn: (obj: unknown, msg: string) => {
        warnLogs.push({ obj, msg });
      },
    } as any;

    const syncEscrowFromEvent = createSyncEscrowFromEventUseCase({
      escrowRepository,
      contractReader,
      allowedTokens: [allowedToken],
      logger: fakeLogger,
    });

    contractReader.seed(
      11n,
      buildChainEscrowRecord({ chainDeliveryId: 11n, token: rogueToken }),
    );

    await syncEscrowFromEvent(buildEscrowEvent({ topic: ['escrow_funded', '11'] }));

    const stored = await escrowRepository.findByChainDeliveryId(11n);
    expect(stored).not.toBeNull();
    expect(stored?.token).toBe(rogueToken);
    expect(stored?.isVerified).toBe(false);
    expect(warnLogs.length).toBeGreaterThan(0);
    expect(warnLogs[0]).toMatchObject({
      msg: expect.stringContaining('Unrecognized payment token'),
    });
  });
});

describe('parseAmount non-negative invariant (#441)', () => {
  it('returns null for negative numbers and negative numeric strings', () => {
    expect(parseAmount(-100)).toBeNull();
    expect(parseAmount('-500')).toBeNull();
    expect(parseAmount('500')).toBe(500n);
  });
});
