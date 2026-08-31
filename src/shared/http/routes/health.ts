import type { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../../database/index.js';
import { getRedisClient } from '../../cache/index.js';
import { getQueueHealth, type QueueCounts } from '../../queue/index.js';

interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'ok' | 'error';
  redis: 'ok' | 'error';
}

interface QueueHealthStatus {
  status: 'ok' | 'degraded' | 'unavailable';
  queues: QueueCounts[];
}

/**
 * A queue with this many jobs waiting and nothing active is treated as
 * stalled (no worker consuming it) rather than merely "has some backlog" —
 * distinct from `failed`/`failedRecent`, which describe jobs that were
 * picked up and then failed, not jobs that were never picked up at all.
 */
const STALLED_WAITING_THRESHOLD = 100;

function isQueueStalled(queue: QueueCounts): boolean {
  return queue.waiting >= STALLED_WAITING_THRESHOLD && queue.active === 0;
}

/**
 * Liveness/readiness probe. Deliberately cheap (single SELECT 1 / PING) —
 * deeper checks like indexer lag live under /health/indexer once the
 * indexer module exists (ARCHITECTURE.md §6), not here.
 */
export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      getPrismaClient().$queryRaw`SELECT 1`.then(() => 'ok' as const).catch(() => 'error' as const),
      getRedisClient()
        .ping()
        .then(() => 'ok' as const)
        .catch(() => 'error' as const),
    ]);

    const body: HealthStatus = {
      status: database === 'ok' && redis === 'ok' ? 'ok' : 'degraded',
      database,
      redis,
    };

    void reply.status(body.status === 'ok' ? 200 : 503).send(body);
  });

  /**
   * Alerting signal, not a liveness/readiness probe — point orchestrator
   * readiness checks at `/health` instead (see docs/DEPLOYMENT.md).
   *
   * `failed` reflects BullMQ's full failure history (jobs are retained for
   * up to 7 days, see `removeOnFail` in `shared/queue/queues.ts`), so it
   * never clears on its own after a single transient failure. `degraded`
   * (200) means "there is failure history worth looking at"; `unavailable`
   * (503) means the queue backend itself couldn't be reached, which is the
   * only case that should be treated as a hard failure by anything acting
   * on the status code.
   */
  app.get('/health/queue', async (_request, reply) => {
    try {
      const queues = await getQueueHealth();
      const stalled = queues.some(isQueueStalled);
      const hasHistoricalFailures = queues.some((queue) => queue.failed > 0);

      if (stalled) {
        const body: QueueHealthStatus = { status: 'unavailable', queues };
        void reply.status(503).send(body);
        return;
      }

      const status: QueueHealthStatus['status'] = hasHistoricalFailures ? 'degraded' : 'ok';
      const body: QueueHealthStatus = { status, queues };
      void reply.status(200).send(body);
    } catch (error) {
      const body: QueueHealthStatus = { status: 'unavailable', queues: [] };
      app.log.error({ err: error }, '[health/queue] failed to reach queue backend');
      void reply.status(503).send(body);
    }
  });
}
