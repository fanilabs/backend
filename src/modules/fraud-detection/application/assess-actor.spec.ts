import { describe, expect, it } from 'vitest';
import { createAssessActorUseCase } from './assess-actor.js';
import { createFixedClock, createInMemoryActorActivityRepository } from './__fixtures__/fakes.js';

describe('assessActor', () => {
  it('returns not-flagged, zero counts for an actor with no activity', async () => {
    const activityRepository = createInMemoryActorActivityRepository();
    const assessActor = createAssessActorUseCase({ activityRepository });

    const result = await assessActor({ address: 'GNEW' });

    expect(result.flagged).toBe(false);
    expect(result.signals).toHaveLength(3);
    expect(result.signals.every((s) => s.count === 0 && !s.triggered)).toBe(true);
  });

  it('flags DELIVERY_CREATION_VELOCITY once the count exceeds the threshold within the window', async () => {
    const activityRepository = createInMemoryActorActivityRepository();
    for (let i = 0; i < 11; i += 1) {
      activityRepository.seed('GBOT', 'DELIVERY_CREATED', new Date());
    }
    const assessActor = createAssessActorUseCase({ activityRepository });

    const result = await assessActor({ address: 'GBOT' });

    const signal = result.signals.find((s) => s.ruleType === 'DELIVERY_CREATION_VELOCITY');
    expect(signal).toMatchObject({ count: 11, threshold: 10, triggered: true });
    expect(result.flagged).toBe(true);
  });

  it('does not count activity outside the rule window', async () => {
    const activityRepository = createInMemoryActorActivityRepository();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (let i = 0; i < 20; i += 1) {
      activityRepository.seed('GOLDACTIVITY', 'DELIVERY_CREATED', twoHoursAgo);
    }
    const assessActor = createAssessActorUseCase({ activityRepository });

    const result = await assessActor({ address: 'GOLDACTIVITY' });

    const signal = result.signals.find((s) => s.ruleType === 'DELIVERY_CREATION_VELOCITY');
    expect(signal).toMatchObject({ count: 0, triggered: false });
  });

  it('flags DISPUTE_RAISE_VELOCITY on its own, wider 24h window and lower threshold', async () => {
    const activityRepository = createInMemoryActorActivityRepository();
    for (let i = 0; i < 4; i += 1) {
      activityRepository.seed('GSCAMMER', 'DISPUTE_RAISED', new Date());
    }
    const assessActor = createAssessActorUseCase({ activityRepository });

    const result = await assessActor({ address: 'GSCAMMER' });

    const signal = result.signals.find((s) => s.ruleType === 'DISPUTE_RAISE_VELOCITY');
    expect(signal).toMatchObject({ count: 4, threshold: 3, windowHours: 24, triggered: true });
    expect(result.flagged).toBe(true);
  });

  describe('under simulated indexer lag', () => {
    it('with an injected fixed clock, activity just inside the window relative to that clock is counted even when wall-clock time has moved on', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      // The indexer is 3 hours behind: this activity's on-chain occurredAt
      // is only 30 minutes before the *ledger* clock, even though real
      // wall-clock "now" (not used here) is much later.
      const laggedLedgerNow = new Date('2026-01-01T12:00:00Z');
      const occurredAt = new Date('2026-01-01T11:30:00Z');
      for (let i = 0; i < 11; i += 1) {
        activityRepository.seed('GLAGGED', 'DELIVERY_CREATED', occurredAt);
      }
      const assessActor = createAssessActorUseCase({
        activityRepository,
        clock: createFixedClock(laggedLedgerNow),
      });

      const result = await assessActor({ address: 'GLAGGED' });

      const signal = result.signals.find((s) => s.ruleType === 'DELIVERY_CREATION_VELOCITY');
      expect(signal).toMatchObject({ count: 11, triggered: true });
    });

    it('without a lag-aware clock, comparing lagged occurredAt values against real wall-clock time would incorrectly exclude them', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      // Real "now" is far ahead of the on-chain occurredAt values because
      // the indexer has fallen behind — with the default systemClock (no
      // clock injected), this activity falls outside every rule window.
      const longAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
      for (let i = 0; i < 11; i += 1) {
        activityRepository.seed('GSTALE', 'DELIVERY_CREATED', longAgo);
      }
      const assessActor = createAssessActorUseCase({ activityRepository });

      const result = await assessActor({ address: 'GSTALE' });

      const signal = result.signals.find((s) => s.ruleType === 'DELIVERY_CREATION_VELOCITY');
      expect(signal).toMatchObject({ count: 0, triggered: false });
    });
  });
});
