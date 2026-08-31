import { describe, expect, it } from 'vitest';
import { createSyncReputationFromEventUseCase } from './sync-reputation-from-event.js';
import {
  buildChainDriverProfile,
  buildDriverProfile,
  buildReputationEvent,
  createFakeLegacyDriverProfileReader,
  createFakeReputationContractReader,
  createInMemoryDriverProfileRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const driverProfileRepository = createInMemoryDriverProfileRepository();
  const contractReader = createFakeReputationContractReader();
  const legacyReader = createFakeLegacyDriverProfileReader();
  const syncReputationFromEvent = createSyncReputationFromEventUseCase({
    driverProfileRepository,
    contractReader,
    legacyReader,
  });
  return { driverProfileRepository, contractReader, legacyReader, syncReputationFromEvent };
}

describe('syncReputationFromEvent', () => {
  it('ignores events from a different contract', async () => {
    const { driverProfileRepository, syncReputationFromEvent } = setup();

    await syncReputationFromEvent(buildReputationEvent({ contractName: 'delivery' }));

    expect(await driverProfileRepository.findByAddress('GDRIVER')).toBeNull();
  });

  it('driver_registered: hydrates the full profile via get_driver_profile, tier derived from score 50 -> SILVER', async () => {
    const { driverProfileRepository, contractReader, syncReputationFromEvent } = setup();
    contractReader.seed(
      'GDRIVER',
      buildChainDriverProfile({ address: 'GDRIVER', reputationScore: 50 }),
    );

    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['driver_registered'], payload: ['GDRIVER'] }),
    );

    const stored = await driverProfileRepository.findByAddress('GDRIVER');
    expect(stored).toMatchObject({ reputationScore: 50, tier: 'SILVER', deliveriesCompleted: 0 });
  });

  it('tier bands: <50 BRONZE, 50-74 SILVER, >=75 GOLD', async () => {
    const { driverProfileRepository, contractReader, syncReputationFromEvent } = setup();

    contractReader.seed('G1', buildChainDriverProfile({ address: 'G1', reputationScore: 49 }));
    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['driver_registered'], payload: ['G1'] }),
    );
    expect((await driverProfileRepository.findByAddress('G1'))?.tier).toBe('BRONZE');

    contractReader.seed('G2', buildChainDriverProfile({ address: 'G2', reputationScore: 74 }));
    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['driver_registered'], payload: ['G2'] }),
    );
    expect((await driverProfileRepository.findByAddress('G2'))?.tier).toBe('SILVER');

    contractReader.seed('G3', buildChainDriverProfile({ address: 'G3', reputationScore: 75 }));
    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['driver_registered'], payload: ['G3'] }),
    );
    expect((await driverProfileRepository.findByAddress('G3'))?.tier).toBe('GOLD');
  });

  it.each([
    [0, 'BRONZE'],
    [49, 'BRONZE'],
    [50, 'SILVER'],
    [74, 'SILVER'],
    [75, 'GOLD'],
    [100, 'GOLD'],
  ] as const)(
    'tier boundary: score %i derives tier %s (mirrors identity_reputation_contract.get_driver_tier)',
    async (score, expectedTier) => {
      const { driverProfileRepository, contractReader, syncReputationFromEvent } = setup();
      const address = `GBOUNDARY${score}`;
      contractReader.seed(address, buildChainDriverProfile({ address, reputationScore: score }));

      await syncReputationFromEvent(
        buildReputationEvent({ topic: ['driver_registered'], payload: [address] }),
      );

      expect((await driverProfileRepository.findByAddress(address))?.tier).toBe(expectedTier);
    },
  );

  it('reputation_increased: refreshes from get_driver_profile rather than reimplementing the +points formula', async () => {
    const { driverProfileRepository, contractReader, syncReputationFromEvent } = setup();
    contractReader.seed(
      'GDRIVER',
      buildChainDriverProfile({ address: 'GDRIVER', reputationScore: 58, deliveriesCompleted: 3 }),
    );

    await syncReputationFromEvent(
      buildReputationEvent({
        topic: ['reputation_increased'],
        payload: ['GDRIVER', '10', 8],
      }),
    );

    const stored = await driverProfileRepository.findByAddress('GDRIVER');
    expect(stored).toMatchObject({ reputationScore: 58, deliveriesCompleted: 3, tier: 'SILVER' });
  });

  it('reputation_decreased: refreshes from get_driver_profile', async () => {
    const { driverProfileRepository, contractReader, syncReputationFromEvent } = setup();
    contractReader.seed(
      'GDRIVER',
      buildChainDriverProfile({ address: 'GDRIVER', reputationScore: 40 }),
    );

    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['reputation_decreased'], payload: ['GDRIVER', 10] }),
    );

    expect((await driverProfileRepository.findByAddress('GDRIVER'))?.tier).toBe('BRONZE');
  });

  it('kyc_status_updated: refreshes kycVerified from get_driver_profile', async () => {
    const { driverProfileRepository, contractReader, syncReputationFromEvent } = setup();
    contractReader.seed(
      'GDRIVER',
      buildChainDriverProfile({ address: 'GDRIVER', kycVerified: true }),
    );

    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['kyc_status_updated'], payload: ['GDRIVER', true] }),
    );

    expect((await driverProfileRepository.findByAddress('GDRIVER'))?.kycVerified).toBe(true);
  });

  it('sets legacyDeliveriesCompleted from the supplementary delivery_contract read when it succeeds', async () => {
    const { driverProfileRepository, contractReader, legacyReader, syncReputationFromEvent } =
      setup();
    contractReader.seed('GDRIVER', buildChainDriverProfile({ address: 'GDRIVER' }));
    legacyReader.seed('GDRIVER', 7);

    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['driver_registered'], payload: ['GDRIVER'] }),
    );

    expect(
      (await driverProfileRepository.findByAddress('GDRIVER'))?.legacyDeliveriesCompleted,
    ).toBe(7);
  });

  it('leaves legacyDeliveriesCompleted at its prior value, not 0, when the legacy read fails', async () => {
    const { driverProfileRepository, contractReader, legacyReader, syncReputationFromEvent } =
      setup();
    driverProfileRepository.seed(
      buildDriverProfile({ address: 'GDRIVER', legacyDeliveriesCompleted: 12 }),
    );
    contractReader.seed('GDRIVER', buildChainDriverProfile({ address: 'GDRIVER' }));
    legacyReader.failFor('GDRIVER');

    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['kyc_status_updated'], payload: ['GDRIVER', false] }),
    );

    expect(
      (await driverProfileRepository.findByAddress('GDRIVER'))?.legacyDeliveriesCompleted,
    ).toBe(12);
  });

  it('user_registered: no-op — no read model exists for the on-chain UserProfile', async () => {
    const { driverProfileRepository, syncReputationFromEvent } = setup();

    await syncReputationFromEvent(
      buildReputationEvent({ topic: ['user_registered'], payload: ['GUSER'] }),
    );

    expect(await driverProfileRepository.findByAddress('GUSER')).toBeNull();
  });
});
