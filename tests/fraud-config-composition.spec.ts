import { PrismaClient } from '@prisma/client';
import type { BlockchainEvent } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/shared/config/env.js';
import * as config from '../src/shared/config/index.js';
import { createFraudDetectionModule } from '../src/modules/fraud-detection/index.js';
import * as routes from '../src/modules/fraud-detection/interface/routes.js';
import * as subscriptions from '../src/modules/fraud-detection/infrastructure/event-subscription.js';
import { createPrismaActorActivityRepository } from '../src/modules/fraud-detection/infrastructure/prisma-actor-activity-repository.js';
import type { ActorActivityRepository } from '../src/modules/fraud-detection/domain/ports.js';
import {
  RULES,
  createAssessActorUseCase,
} from '../src/modules/fraud-detection/application/assess-actor.js';
import {
  createFixedClock,
  createInMemoryActorActivityRepository,
} from '../src/modules/fraud-detection/application/__fixtures__/fakes.js';

const required = {
  DATABASE_URL: 'postgresql://fixture:fixture@localhost:9/fixture',
  REDIS_URL: 'redis://127.0.0.1:9',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  NODE_ENV: 'production',
};
const fields = [
  'FRAUD_DELIVERY_VELOCITY_THRESHOLD',
  'FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS',
  'FRAUD_ESCROW_VELOCITY_THRESHOLD',
  'FRAUD_ESCROW_VELOCITY_WINDOW_HOURS',
  'FRAUD_DISPUTE_VELOCITY_THRESHOLD',
  'FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS',
] as const;
const ledgerTime = new Date('2026-01-01T12:00:00Z');
const ledgerRow: BlockchainEvent = {
  id: 'ledger',
  contractName: 'delivery',
  network: 'testnet',
  rpcEventId: 'event',
  ledgerSeq: 123n,
  txHash: 'hash',
  topic: ['delivery_created'],
  payload: [],
  ledgerClosedAt: ledgerTime,
  ingestedAt: ledgerTime,
  processedAt: null,
};

afterEach(() => vi.restoreAllMocks());

describe('fraud configuration through production composition', () => {
  it.each([
    { label: 'defaults', overrides: {}, thresholds: [10, 10, 3], windows: [1, 1, 24] },
    {
      label: 'explicit overrides',
      overrides: {
        FRAUD_DELIVERY_VELOCITY_THRESHOLD: '2',
        FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS: '2',
        FRAUD_ESCROW_VELOCITY_THRESHOLD: '4',
        FRAUD_ESCROW_VELOCITY_WINDOW_HOURS: '3',
        FRAUD_DISPUTE_VELOCITY_THRESHOLD: '6',
        FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS: '48',
      },
      thresholds: [2, 4, 6],
      windows: [2, 3, 48],
    },
  ])(
    'uses $label in the actual evaluator/repository/ledger-clock graph',
    async ({ overrides, thresholds, windows }) => {
      vi.spyOn(config, 'getConfig').mockReturnValue(parseEnv({ ...required, ...overrides }));
      // Capture only the HTTP boundary and avoid registering a global event
      // subscription. The evaluator, clock and repository are real implementations.
      const routeFactory = vi.spyOn(routes, 'createFraudDetectionRoutes');
      vi.spyOn(subscriptions, 'subscribeFraudDetectionEventDispatch').mockReturnValue(() => {});
      const prisma = new PrismaClient();
      const latest = vi.spyOn(prisma.blockchainEvent, 'findFirst').mockResolvedValue(ledgerRow);
      const find = vi.spyOn(prisma.actorActivity, 'findMany').mockResolvedValue([]);
      for (const [index, rule] of RULES.entries()) {
        find.mockResolvedValueOnce(
          Array.from({ length: thresholds[index]! }, (_, row) => ({
            id: `${index}-${row}`,
            address: 'actor',
            category: rule.category,
            occurredAt: ledgerTime,
            createdAt: ledgerTime,
            updatedAt: ledgerTime,
          })),
        );
      }
      const count = vi.spyOn(prisma.actorActivity, 'count');
      createFraudDetectionModule(prisma);
      expect(routeFactory).toHaveBeenCalledTimes(1);
      const assess = routeFactory.mock.calls[0]![0].assessActor;
      const result = await assess({ address: 'actor' });
      expect(latest).toHaveBeenCalledWith({
        orderBy: { ledgerClosedAt: 'desc' },
        select: { ledgerClosedAt: true },
      });
      expect(result.signals.map((s) => s.threshold)).toEqual(thresholds);
      expect(result.signals.map((s) => s.windowHours)).toEqual(windows);
      expect(result.signals.map((s) => s.ruleType)).toEqual(RULES.map((r) => r.ruleType));
      expect(result.signals.map((s) => s.category)).toEqual(RULES.map((r) => r.category));
      expect(result.flagged).toBe(false);
      expect(result.signals.map((signal) => signal.count)).toEqual(thresholds);
      for (const [index, rule] of RULES.entries()) {
        expect(find).toHaveBeenCalledWith({
          where: {
            address: 'actor',
            category: rule.category,
            occurredAt: { gte: new Date(ledgerTime.getTime() - windows[index]! * 3600000) },
          },
          take: thresholds[index]! + 1,
          select: { id: true },
        });
      }
      expect(count).not.toHaveBeenCalled();
      for (const [index, rule] of RULES.entries()) {
        find.mockResolvedValueOnce(
          Array.from({ length: thresholds[index]! + 1 }, (_, row) => ({
            id: `${index}-${row}`,
            address: 'actor',
            category: rule.category,
            occurredAt: ledgerTime,
            createdAt: ledgerTime,
            updatedAt: ledgerTime,
          })),
        );
      }
      const above = await assess({ address: 'actor' });
      expect(above.flagged).toBe(true);
      expect(above.signals.every((signal) => signal.triggered)).toBe(true);
      expect(above.signals.map((signal) => signal.count)).toEqual(
        thresholds.map((threshold) => threshold + 1),
      );
      expect(latest).toHaveBeenCalledTimes(1);
      await prisma.$disconnect();
    },
  );

  it.each(fields)('rejects invalid %s at module construction', (field) => {
    vi.spyOn(config, 'getConfig').mockImplementation(() => parseEnv({ ...required, [field]: '0' }));
    const subscribe = vi.spyOn(subscriptions, 'subscribeFraudDetectionEventDispatch');
    const prisma = new PrismaClient();
    expect(() => createFraudDetectionModule(prisma)).toThrow(field);
    expect(subscribe).not.toHaveBeenCalled();
  });
});

describe('fraud configuration validation', () => {
  it.each(
    fields.flatMap((field) =>
      ['0', '-1', '1.5', 'abc', '', 'Infinity'].map((value) => ({ field, value })),
    ),
  )('rejects $field=$value', ({ field, value }) => {
    expect(() => parseEnv({ ...required, [field]: value })).toThrow(new RegExp(field));
  });
});

describe('fraud rule boundaries', () => {
  it.each(
    RULES.flatMap((rule) =>
      [rule.threshold - 1, rule.threshold, rule.threshold + 1].map((count) => ({ rule, count })),
    ),
  )('$rule.ruleType count=$count retains the strict threshold', async ({ rule, count }) => {
    const activityRepository = createInMemoryActorActivityRepository();
    for (let i = 0; i < count; i += 1) activityRepository.seed('actor', rule.category, ledgerTime);
    const assess = createAssessActorUseCase({
      activityRepository,
      clock: createFixedClock(ledgerTime),
    });
    const result = await assess({ address: 'actor' });
    expect(result.signals.find((s) => s.ruleType === rule.ruleType)).toMatchObject({
      count,
      threshold: rule.threshold,
      triggered: count > rule.threshold,
    });
    expect(result.flagged).toBe(count > rule.threshold);
  });

  it.each(RULES)(
    '$ruleType uses injected hours, inclusive cutoff and threshold+1',
    async (rule) => {
      const custom = { ...rule, windowHours: 2, threshold: 2 };
      const activityRepository = createInMemoryActorActivityRepository();
      const cutoff = new Date(ledgerTime.getTime() - 2 * 3600000);
      activityRepository.seed('actor', rule.category, new Date(cutoff.getTime() - 1));
      activityRepository.seed('other', rule.category, ledgerTime);
      activityRepository.seed('actor', rule.category, cutoff);
      activityRepository.seed('actor', rule.category, ledgerTime);
      const countSince = vi.spyOn(activityRepository, 'countSince');
      const assess = createAssessActorUseCase({
        activityRepository,
        clock: createFixedClock(ledgerTime),
        ruleDefinitions: [custom],
      });
      const first = await assess({ address: 'actor' });
      expect(first.signals).toEqual([{ ...custom, count: 2, triggered: false }]);
      activityRepository.seed('actor', rule.category, ledgerTime);
      expect((await assess({ address: 'actor' })).signals).toEqual([
        { ...custom, count: 3, triggered: true },
      ]);
      expect(countSince).toHaveBeenCalledWith('actor', rule.category, cutoff, 3);
    },
  );
});

describe('fraud repository port compatibility', () => {
  it('records only port fields, returns void and preserves failures', async () => {
    const prisma = new PrismaClient();
    const input = {
      address: 'actor',
      category: 'DELIVERY_CREATED',
      occurredAt: ledgerTime,
    } as const;
    const create = vi.spyOn(prisma.actorActivity, 'create').mockResolvedValue({
      ...input,
      id: 'generated',
      createdAt: ledgerTime,
      updatedAt: ledgerTime,
    });
    const repository: ActorActivityRepository = createPrismaActorActivityRepository(prisma);
    await expect(repository.record(input)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledWith({ data: input });
    const failure = new Error('fixture database error');
    create.mockRejectedValue(failure);
    await expect(repository.record(input)).rejects.toBe(failure);
    await prisma.$disconnect();
  });

  it('uses capped selection only when requested, otherwise counts with identical filters', async () => {
    const prisma = new PrismaClient();
    const repository: ActorActivityRepository = createPrismaActorActivityRepository(prisma);
    const find = vi.spyOn(prisma.actorActivity, 'findMany').mockResolvedValue(
      Array.from({ length: 4 }, (_, i) => ({
        id: String(i),
        address: 'actor',
        category: 'DISPUTE_RAISED',
        occurredAt: ledgerTime,
        createdAt: ledgerTime,
        updatedAt: ledgerTime,
      })),
    );
    const count = vi.spyOn(prisma.actorActivity, 'count').mockResolvedValue(20);
    expect(await repository.countSince('actor', 'DISPUTE_RAISED', ledgerTime, 4)).toBe(4);
    const where = { address: 'actor', category: 'DISPUTE_RAISED', occurredAt: { gte: ledgerTime } };
    expect(find).toHaveBeenCalledWith({ where, take: 4, select: { id: true } });
    expect(count).not.toHaveBeenCalled();
    expect(await repository.countSince('actor', 'DISPUTE_RAISED', ledgerTime)).toBe(20);
    expect(count).toHaveBeenCalledWith({ where });
    await prisma.$disconnect();
  });
});
