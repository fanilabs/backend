import { getQueue, QueueName } from './queues.js';

export interface QueueCounts {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

const MONITORED_QUEUES = [QueueName.BlockchainIndexer, QueueName.Notifications] as const;

export async function getQueueHealth(): Promise<QueueCounts[]> {
  return Promise.all(
    MONITORED_QUEUES.map(async (name) => {
      const queue = getQueue(name);
      const counts = await queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );
      return {
        name,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
      };
    }),
  );
}
