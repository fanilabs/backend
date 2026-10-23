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
  /**
   * Counts activities for `address`/`category` with `occurredAt >= since`.
   * When `limit` is provided the count is capped at `limit` (the query
   * short-circuits once that many rows are found) — callers that only need
   * to know whether a threshold was reached should pass `threshold + 1` so
   * high-volume actors don't force a full count of every matching row.
   */
  countSince(
    address: string,
    category: ActorActivityCategory,
    since: Date,
    limit?: number,
  ): Promise<number>;
  /**
   * Deletes rows with `occurredAt` older than `olderThan`, in batches of at
   * most `batchSize` for at most `maxIterations` batches per invocation,
   * returning the total number of rows removed. Used by the scheduled
   * retention job (`../infrastructure/cleanup-queue.ts`) — bounded both per
   * batch and per run so a large backlog cannot hold long table locks or
   * exceed BullMQ worker lock duration (issue #469).
   */
  deleteOlderThan(olderThan: Date, batchSize: number, maxIterations?: number): Promise<number>;
  /**
   * Purges rows with `occurredAt` older than `cutoff` using default batch and
   * iteration bounds, returning the number of rows deleted.
   */
  deleteOlderThan(cutoff: Date): Promise<number>;
}
