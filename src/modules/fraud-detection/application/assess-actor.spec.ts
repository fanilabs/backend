import { describe, it, expect, vi } from 'vitest';
import { createAssessActorUseCase, RULES, type RuleDefinition } from './assess-actor.js';
import { createFixedClock, createInMemoryActorActivityRepository } from './__fixtures__/fakes.js';
import type { ActorAssessment, ActorActivityCategory } from '../domain/index.js';

const now = new Date('2024-01-01T00:00:00.000Z');
function makeRepository(count: number, category: ActorActivityCategory = 'DELIVERY_CREATED') {
  const repository = createInMemoryActorActivityRepository();
  for (let i = 0; i < count; i += 1) repository.seed('actor-1', category, now);
  return repository;
}

describe('createAssessActorUseCase', () => {
  it('uses default RULES when no ruleDefinitions are provided', async () => {
    const activityRepository = makeRepository(11);
    const assessActor = createAssessActorUseCase({
      activityRepository,
      clock: createFixedClock(now),
    });
    const result = await assessActor({ address: 'actor-1' });

    expect(result.flagged).toBe(true);
    expect(result.signals).toContainEqual(
      expect.objectContaining({ ruleType: 'DELIVERY_CREATION_VELOCITY', triggered: true }),
    );
  });

  it('does not flag an actor below the default threshold', async () => {
    const activityRepository = makeRepository(9);
    const assessActor = createAssessActorUseCase({
      activityRepository,
      clock: createFixedClock(now),
    });
    const result = await assessActor({ address: 'actor-1' });

    expect(result.flagged).toBe(false);
  });

  it('flags an actor after 3 activities when a custom threshold of 2 is injected', async () => {
    const customRules: RuleDefinition[] = [
      {
        ruleType: 'DELIVERY_CREATION_VELOCITY',
        category: 'DELIVERY_CREATED',
        windowHours: 1,
        threshold: 2,
      },
    ];
    const activityRepository = makeRepository(3);
    const assessActor = createAssessActorUseCase({
      activityRepository,
      clock: createFixedClock(now),
      ruleDefinitions: customRules,
    });
    const result = await assessActor({ address: 'actor-1' });

    expect(result.flagged).toBe(true);
    expect(result.signals).toContainEqual(
      expect.objectContaining({ ruleType: 'DELIVERY_CREATION_VELOCITY', triggered: true }),
    );
  });

  it('does not flag an actor below a custom threshold', async () => {
    const customRules: RuleDefinition[] = [
      {
        ruleType: 'DELIVERY_CREATION_VELOCITY',
        category: 'DELIVERY_CREATED',
        windowHours: 1,
        threshold: 2,
      },
    ];
    const activityRepository = makeRepository(2);
    const assessActor = createAssessActorUseCase({
      activityRepository,
      clock: createFixedClock(now),
      ruleDefinitions: customRules,
    });
    const result = await assessActor({ address: 'actor-1' });

    expect(result.flagged).toBe(false);
  });

  it('exposes the default RULES with the documented thresholds', () => {
    const byName = Object.fromEntries(RULES.map((rule) => [rule.ruleType, rule]));

    expect(byName.DELIVERY_CREATION_VELOCITY).toMatchObject({
      windowHours: 1,
      threshold: 10,
    });
    expect(byName.ESCROW_RELEASE_VELOCITY).toMatchObject({
      windowHours: 1,
      threshold: 10,
    });
    expect(byName.DISPUTE_RAISE_VELOCITY).toMatchObject({
      windowHours: 24,
      threshold: 3,
    });
  });

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

  describe('alerting', () => {
    it('dispatches the full assessment through the alert callback when an actor is flagged', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      for (let i = 0; i < 11; i += 1) {
        activityRepository.seed('GBOTALERT', 'DELIVERY_CREATED', new Date());
      }
      const alertPublisher = vi
        .fn<(assessment: ActorAssessment) => Promise<void>>()
        .mockResolvedValue(undefined);
      const assessActor = createAssessActorUseCase({ activityRepository, alertPublisher });

      const result = await assessActor({ address: 'GBOTALERT' });

      expect(result.flagged).toBe(true);
      expect(alertPublisher).toHaveBeenCalledTimes(1);
      const event = alertPublisher.mock.calls[0]![0];
      expect(alertPublisher).toHaveBeenCalledWith(result);
      expect(event).toMatchObject({ address: 'GBOTALERT' });
      expect(event.signals).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ruleType: 'DELIVERY_CREATION_VELOCITY', triggered: true }),
        ]),
      );
      expect(event.signals).toEqual(result.signals);
      expect(event.signals.some((signal) => !signal.triggered)).toBe(true);
    });

    it('does not dispatch an alert when the actor is not flagged', async () => {
      const activityRepository = createInMemoryActorActivityRepository();
      const alertPublisher = vi
        .fn<(assessment: ActorAssessment) => Promise<void>>()
        .mockResolvedValue(undefined);
      const assessActor = createAssessActorUseCase({ activityRepository, alertPublisher });

      const result = await assessActor({ address: 'GCLEAN' });

      expect(result.flagged).toBe(false);
      expect(alertPublisher).not.toHaveBeenCalled();
    });
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
