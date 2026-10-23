import { EventEmitter } from 'node:events';
import { eventSubscriberErrorsTotal } from '../metrics/index.js';
import { logger } from '../logger/index.js';
import type { Logger } from '../logger/index.js';

export { parseAddress, parseBigIntId } from './parse.js';
export { ContractName } from './contract-names.js';

/**
 * Every durably-stored blockchain event, after decoding, in one shape —
 * module handlers (deliveries, escrow, disputes, ...) subscribe here once
 * they exist. Deliberately in-process only for v1, not a distributed bus
 * (ARCHITECTURE.md §11) — if the indexer ever needs to run as more than one
 * instance, this is the seam to swap for Redis Streams or similar.
 */
export interface BlockchainEventEnvelope {
  contractName: string;
  network: string;
  rpcEventId: string;
  ledgerSeq: bigint;
  txHash: string;
  topic: string[];
  payload: unknown;
  /** On-chain ledger close time — use this, not `new Date()`, when a
   * handler needs an on-chain timestamp. */
  closedAt: Date;
}

const CHANNEL = 'blockchain-event';

const bus = new EventEmitter();
// Generous default — every future module that consumes blockchain events
// (deliveries, escrow, disputes, reputation, fleet, notifications,
// fraud-detection per ARCHITECTURE.md §10) subscribes on this one channel.
bus.setMaxListeners(50);

/**
 * Upper bound on subscriber executions in flight at any moment, process-wide
 * (issue #349). Node's EventEmitter.emit is synchronous and never awaits
 * async listeners, so the previous fire-and-forget publish let event
 * replay / post-downtime catch-up fire hundreds of database writes in
 * parallel at once — swamping the PostgreSQL pool and process memory.
 * Every subscriber run (across all publishes) now goes through one shared
 * queue that admits at most this many concurrent tasks. No new dependency:
 * the pool is a few dozen lines and the semantics above are all we need.
 *
 * Reentrancy caveat: a subscriber must not itself `await` a
 * `publishBlockchainEvent` call (none do — only the indexer's poll loop and
 * tests publish), since a task holding a slot while waiting for a queued one
 * could stall the queue.
 */
export const EVENT_DISPATCH_CONCURRENCY = 10;

type SubscriberTask = () => void | Promise<void>;

interface QueuedDispatch {
  event: BlockchainEventEnvelope;
  task: SubscriberTask;
  settle: () => void;
}

let activeDispatches = 0;
const pendingDispatches: QueuedDispatch[] = [];
let drainingQueue = false;

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return (
    value !== null && value !== undefined && typeof (value as Promise<void>).then === 'function'
  );
}

function releaseSlot(): void {
  activeDispatches -= 1;
  drainPending();
}

/** Start queued tasks while capacity allows. A task that completes
 * synchronously frees its slot immediately (so its successor can start in
 * the same tick, preserving delivery order for synchronous listeners); one
 * that returns a promise holds the slot until it settles, and its completion
 * re-enters this drain. The flag makes the sync path's nested
 * `releaseSlot()` a no-op so the loop — not recursion — drives the drain. */
function drainPending(): void {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    while (activeDispatches < EVENT_DISPATCH_CONCURRENCY && pendingDispatches.length > 0) {
      const next = pendingDispatches.shift();
      if (!next) return;
      activeDispatches += 1;
      const pending = runTask(next.event, next.task);
      if (pending) {
        void pending.then(next.settle);
        return; // async task — wait for its completion to free the slot
      }
      next.settle();
    }
  } finally {
    drainingQueue = false;
  }
}

/** Run one subscriber. Returns `null` when the task finished synchronously
 * (slot already released), or a promise that settles — after releasing the
 * slot — when it went async. The returned promise never rejects: a subscriber
 * failure is recorded (module handlers are wrapped by
 * `subscribeBlockchainEventHandler`, which counts and logs with its own
 * subscriber label; a raw listener's throw/rejection lands here as a
 * last-resort counter) and must not block or fail the publish. */
function runTask(event: BlockchainEventEnvelope, task: SubscriberTask): Promise<void> | null {
  let result: void | Promise<void>;
  try {
    result = task();
  } catch (error: unknown) {
    recordUnhandledFailure(event, error);
    releaseSlot();
    return null;
  }
  if (isPromiseLike(result)) {
    return result.then(
      () => {
        releaseSlot();
      },
      (error: unknown) => {
        recordUnhandledFailure(event, error);
        releaseSlot();
      },
    );
  }
  releaseSlot();
  return null;
}

/** Last-resort visibility for failures escaping a raw `onBlockchainEvent`
 * listener — without it the dispatcher would have to swallow them silently,
 * the exact failure mode issue #348 is about. Module handlers are wrapped by
 * `subscribeBlockchainEventHandler`, which counts and logs with its own
 * subscriber label before any error could reach here. */
function recordUnhandledFailure(event: BlockchainEventEnvelope, error: unknown): void {
  eventSubscriberErrorsTotal.inc({
    contract: event.contractName,
    event: event.topic[0] ?? 'unknown',
    subscriber: 'onBlockchainEvent',
  });
  logger.error({ err: error, event }, 'Event subscriber listener failed');
}

function dispatch(event: BlockchainEventEnvelope, task: SubscriberTask): Promise<void> {
  if (activeDispatches < EVENT_DISPATCH_CONCURRENCY) {
    activeDispatches += 1;
    const pending = runTask(event, task);
    if (pending) return pending;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    pendingDispatches.push({ event, task, settle: resolve });
  });
}

/**
 * Publish one event to every current subscriber and resolve once **all** of
 * their executions have finished — with bounded concurrency
 * ({@link EVENT_DISPATCH_CONCURRENCY}), never an unbounded fan-out of
 * fire-and-forget promises.
 *
 * Synchronous subscribers are still invoked before this returns (the fast
 * path starts a task immediately when a slot is free), so existing
 * "publish, then assert" call sites keep working. Async subscribers start
 * immediately too, up to the concurrency cap; the remainder are queued.
 *
 * The indexer's poll loop awaits this before advancing its checkpoint
 * (`poll-contract-events.ts`), so batch N is fully handled before batch
 * N+1 is ingested. Never rejects — subscriber failures are logged and
 * counted (`event_subscriber_errors_total`), not rethrown at the publisher.
 */
export function publishBlockchainEvent(event: BlockchainEventEnvelope): Promise<void> {
  const listeners = bus.listeners(CHANNEL) as Array<
    (event: BlockchainEventEnvelope) => void | Promise<void>
  >;
  if (listeners.length === 0) return Promise.resolve();
  return Promise.all(listeners.map((listener) => dispatch(event, () => listener(event)))).then(
    () => undefined,
  );
}

/** Returns an unsubscribe function — call it on module/test teardown. The
 * handler may be async; its returned promise is awaited by the dispatch
 * (bounded concurrency, see {@link publishBlockchainEvent}). */
export function onBlockchainEvent(
  handler: (event: BlockchainEventEnvelope) => void | Promise<void>,
): () => void {
  bus.on(CHANNEL, handler);
  return () => {
    bus.off(CHANNEL, handler);
  };
}

/**
 * The six-line subscription boilerplate every module's
 * infrastructure/event-subscription.ts used to repeat: subscribe to the bus,
 * invoke the module's async handler, and catch the rejection.
 * The catch must live here rather than becoming an unhandled promise
 * rejection — one malformed/unexpected event must not crash the process or
 * block subsequent events (docs/EVENT_INDEXER.md's malformed-event handling).
 * Besides logging, the catch block increments
 * `event_subscriber_errors_total` — without that counter a failing handler
 * silently let the read model drift from on-chain state with nothing for
 * Prometheus/Grafana to alert on (docs/OBSERVABILITY.md § Metrics).
 *
 * The callback hands the caught promise back to the dispatch, so
 * `publishBlockchainEvent` — and with it the indexer's checkpoint — waits
 * for this handler (success *or* failure) to finish. A synchronous throw
 * from a non-async handler is recorded here too rather than escaping to the
 * dispatcher's generic path, so the metric keeps this subscriber's label.
 */
export function subscribeBlockchainEventHandler(
  handler: (event: BlockchainEventEnvelope) => Promise<unknown>,
  log: Logger,
  errorMessage: string,
): () => void {
  const recordFailure = (event: BlockchainEventEnvelope, error: unknown): void => {
    eventSubscriberErrorsTotal.inc({
      contract: event.contractName,
      event: event.topic[0] ?? 'unknown',
      subscriber: errorMessage,
    });
    log.error({ err: error, event }, errorMessage);
  };

  return onBlockchainEvent((event) => {
    let result: Promise<unknown>;
    try {
      result = handler(event);
    } catch (error: unknown) {
      recordFailure(event, error);
      return;
    }
    return result.then(
      () => undefined,
      (error: unknown) => {
        recordFailure(event, error);
      },
    );
  });
}

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  occurredAt: Date;
}

export interface ActorFlaggedPayload {
  address: string;
  signals: string[];
}

export type ActorFlaggedEvent = DomainEvent<'actor_flagged', ActorFlaggedPayload>;

export function createActorFlaggedEvent(payload: ActorFlaggedPayload): ActorFlaggedEvent {
  return {
    type: 'actor_flagged',
    payload,
    occurredAt: new Date(),
  };
}
