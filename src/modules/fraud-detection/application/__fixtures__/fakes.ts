import { randomUUID } from 'node:crypto';
import { testAddress } from '../../../../shared/testing/addresses.js';
import type { BlockchainEventEnvelope } from '../../../../shared/events/index.js';
import type { ActorActivityCategory, ActorActivityRepository, Clock } from '../../domain/index.js';

/** A `Clock` fixed to a given instant, for deterministic window tests. */
export function createFixedClock(at: Date): Clock {
  return { now: () => Promise.resolve(at) };
}

export function createInMemoryActorActivityRepository(): ActorActivityRepository & {
  seed(address: string, category: ActorActivityCategory, occurredAt: Date): void;
  all(): Array<{ address: string; category: ActorActivityCategory; occurredAt: Date }>;
} {
  const rows: Array<{ address: string; category: ActorActivityCategory; occurredAt: Date }> = [];

  return {
    seed(address, category, occurredAt) {
      rows.push({ address, category, occurredAt });
    },
    all() {
      return rows;
    },
    async record(input) {
      rows.push({ address: input.address, category: input.category, occurredAt: input.occurredAt });
    },
    async countSince(address, category, since, limit) {
      const count = rows.filter(
        (row) => row.address === address && row.category === category && row.occurredAt >= since,
      ).length;
      return limit === undefined ? count : Math.min(count, limit);
    },
    async deleteOlderThan(olderThan) {
      let removed = 0;
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row !== undefined && row.occurredAt < olderThan) {
          rows.splice(i, 1);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export function buildBlockchainEvent(
  overrides: Partial<BlockchainEventEnvelope> = {},
): BlockchainEventEnvelope {
  return {
    contractName: 'delivery',
    network: 'testnet',
    rpcEventId: randomUUID(),
    ledgerSeq: 1000n,
    txHash: 'tx-hash',
    topic: ['delivery_created'],
    payload: ['1', testAddress('sender')],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
