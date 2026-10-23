import { Queue, type QueueOptions } from 'bullmq';
import { getQueueConnection } from './connection.js';

/**
 * Canonical queue names shared between producers (API process) and
 * consumers (worker process — src/workers/index.ts). Modules reference
 * these constants rather than hardcoding strings, so a rename is a one-line
 * change instead of a grep-and-pray.
 */
export const QueueName = {
  BlockchainIndexer: 'blockchain-indexer',
  Notifications: 'notifications',
  FraudActivityCleanup: 'fraud-activity-cleanup',
} as const;

export type QueueNameValue = (typeof QueueName)[keyof typeof QueueName];

const defaultQueueOptions: Omit<QueueOptions, 'connection'> = {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800 },
  },
};

const queues = new Map<QueueNameValue, Queue>();

/** Returns a memoized BullMQ Queue producer handle for the given queue name. */
export function getQueue(name: QueueNameValue): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, { connection: getQueueConnection(), ...defaultQueueOptions });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeAllQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}

/**
 * Pauses every known queue so no new jobs are delivered to workers while
 * operators run zero-downtime database migrations or contract upgrades
 * (#360). Queues are created lazily via `getQueue`, so this iterates the
 * canonical `QueueName` registry (not just already-instantiated handles)
 * to guarantee full coverage, then pauses any extra handles that exist.
 *
 * Pausing is idempotent in BullMQ — calling it on an already-paused queue
 * is a no-op.
 */
export async function pauseAllQueues(): Promise<void> {
  const names = new Set<QueueNameValue>([...Object.values(QueueName), ...queues.keys()]);
  for (const name of names) {
    await getQueue(name).pause();
  }
}

/**
 * Resumes every known queue after a maintenance window ends (#360).
 * Mirrors `pauseAllQueues` — iterates the canonical registry plus any
 * already-instantiated handles.
 */
export async function resumeAllQueues(): Promise<void> {
  const names = new Set<QueueNameValue>([...Object.values(QueueName), ...queues.keys()]);
  for (const name of names) {
    await getQueue(name).resume();
  }
}

/**
 * Removes all jobs (waiting, delayed, failed, completed) from every known
 * queue — the "empty everything now" half of a maintenance-window toolkit
 * alongside `pauseAllQueues`/`resumeAllQueues` (#360). Prefer
 * `queue.obliterate()` semantics only when a full reset — including repeat
 * metadata — is intended; `drain` keeps repeatable-job schedules intact.
 */
export async function drainAllQueues(): Promise<void> {
  const names = new Set<QueueNameValue>([...Object.values(QueueName), ...queues.keys()]);
  for (const name of names) {
    await getQueue(name).drain();
  }
}
