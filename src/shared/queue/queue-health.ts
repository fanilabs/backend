import { getQueue, QueueName } from './queues.js';

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  /** Jobs that failed within the last `RECENT_FAILURE_WINDOW_MS`. Unlike
   * `failed` (which reflects BullMQ's full failure history — up to 7 days
   * of retained jobs, see `queues.ts`'s `removeOnFail`), this is the signal
   * that can actually clear on its own once a transient issue is over. */
  failedRecent: number;
}

/**
 * `ReputationReconciliation` is deliberately excluded — it's a queue name
 * declared for a reconciliation flow that was never actually built
 * (`reputation` ended up doing a synchronous full-refresh instead, see
 * that module's `sync-reputation-from-event.ts`); reporting health for a
 * queue nothing ever produces to or consumes from would be misleading,
 * not informative.
 */
const MONITORED_QUEUES = [QueueName.BlockchainIndexer, QueueName.Notifications] as const;

/** Window used for `failedRecent` — long enough to catch a burst, short
 * enough that a single transient failure clears well within an operator's
 * shift rather than lingering for the full 7-day `removeOnFail` retention. */
export const RECENT_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/** Bounded page size for the recency scan — this is a health check, not a
 * report; it only needs to know whether *any* recent failures exist, not
 * enumerate every historical one. */
const RECENT_FAILURE_SCAN_LIMIT = 50;

async function countRecentFailures(queue: ReturnType<typeof getQueue>): Promise<number> {
  const since = Date.now() - RECENT_FAILURE_WINDOW_MS;
  // getFailed returns jobs ordered most-recent-first; a bounded scan is
  // enough because BullMQ's own `finishedOn` timestamps only get older as
  // the scan proceeds — once we're past the window we can stop.
  const recentFailures = await queue.getFailed(0, RECENT_FAILURE_SCAN_LIMIT - 1);
  let count = 0;
  for (const job of recentFailures) {
    if ((job.finishedOn ?? 0) >= since) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

export async function getQueueHealth(): Promise<QueueCounts[]> {
  return Promise.all(
    MONITORED_QUEUES.map(async (name) => {
      const queue = getQueue(name);
      const [counts, failedRecent] = await Promise.all([
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed'),
        countRecentFailures(queue),
      ]);
      return {
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        failedRecent,
      };
    }),
  );
}
