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
  ReputationReconciliation: 'reputation-reconciliation',
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
