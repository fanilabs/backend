import { randomUUID } from 'node:crypto';
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
    async countSince(address, category, since) {
      return rows.filter(
        (row) => row.address === address && row.category === category && row.occurredAt >= since,
      ).length;
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
    payload: ['1', 'GSENDER'],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
