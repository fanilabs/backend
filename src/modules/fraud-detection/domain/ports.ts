import type { ActorActivityCategory } from './entities.js';

export interface RecordActivityInput {
  address: string;
  category: ActorActivityCategory;
  occurredAt: Date;
}

/**
 * Durable, append-only per-actor activity log — see `prisma/schema.prisma`'s
 * `ActorActivity` model comment for why this is a raw log rather than an
 * incrementally-maintained score. `record` is a pure insert with no
 * dedup key of its own: it relies on the indexer's own guarantee that
 * `publishBlockchainEvent` fires at most once per unique on-chain event
 * (`poll-contract-events.ts` only publishes an event it just newly
 * inserted into `blockchain_events`), the same guarantee every other
 * module's own event handler already depends on implicitly.
 */
export interface ActorActivityRepository {
  record(input: RecordActivityInput): Promise<void>;
  countSince(address: string, category: ActorActivityCategory, since: Date): Promise<number>;
  /**
   * Deletes rows with `occurredAt` older than `olderThan`, in batches of at
   * most `batchSize`, returning the total number of rows removed. Used by
   * the scheduled retention job (`../infrastructure/cleanup-queue.ts`) —
   * batched so a large backlog can't hold a single long-running delete
   * that locks the table, see `prisma/schema.prisma`'s `ActorActivity`
   * comment and `FRAUD_ACTIVITY_RETENTION_DAYS` in `shared/config/env.ts`.
   */
  deleteOlderThan(olderThan: Date, batchSize: number): Promise<number>;
}
