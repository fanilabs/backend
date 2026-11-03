import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerExecutionStatus } from '../shared/queue/worker-execution.js';

const lifecycle = vi.hoisted(() => ({
  write: vi.fn(async () => true),
  shutdown: undefined as undefined | ((event: { err?: Error }) => Promise<void>),
}));
// Loading job composition is unnecessary under the restriction. Fail if the
// entrypoint imports it, rather than allowing mocked factories to hide effects.
vi.mock('../modules/indexer/index.js', () => {
  throw new Error('Indexer must not load');
});
vi.mock('../modules/notifications/index.js', () => {
  throw new Error('Notifications must not load');
});
vi.mock('../modules/fraud-detection/index.js', () => {
  throw new Error('Cleanup must not load');
});
vi.mock('close-with-grace', () => ({
  default: vi.fn((_options: unknown, shutdown: (event: { err?: Error }) => Promise<void>) => {
    lifecycle.shutdown = shutdown;
    return { close: vi.fn() };
  }),
}));
vi.mock('./heartbeat.js', () => ({
  HEARTBEAT_INTERVAL_MS: 15_000,
  createHeartbeatController: vi.fn(() => ({ write: lifecycle.write })),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('restricted worker entrypoint', () => {
  it('loads without activating the historical registry, scheduling jobs or starting timers', async () => {
    vi.useFakeTimers();
    const { registerWorkers } = await import('./index.js');
    expect(registerWorkers).toEqual([]);
    expect(Object.isFrozen(registerWorkers)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(lifecycle.write).not.toHaveBeenCalled();
    expect(lifecycle.shutdown).toBeUndefined();
    expect(workerExecutionStatus.status).toBe('blocked');
    expect(workerExecutionStatus.jobs).toEqual([
      {
        queue: 'blockchain-indexer',
        status: 'blocked',
        reason: 'consumer_completion_and_checkpoint_recovery_unverified',
      },
      {
        queue: 'notifications',
        status: 'blocked',
        reason: 'delivery_outbox_and_ambiguous_send_recovery_unverified',
      },
      {
        queue: 'fraud-activity-cleanup',
        status: 'blocked',
        reason: 'safe_retention_frontier_and_bounded_deletion_unverified',
      },
    ]);
  });

  it('runs only the liveness heartbeat and cancels it during graceful shutdown', async () => {
    vi.useFakeTimers();
    const { startWorkerProcess } = await import('./index.js');
    await startWorkerProcess();
    expect(lifecycle.write).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(lifecycle.write).toHaveBeenCalledTimes(2);
    const shutdown = lifecycle.shutdown;
    if (!shutdown) throw new Error('Graceful shutdown was not installed');
    await shutdown({});
    expect(vi.getTimerCount()).toBe(0);
  });
});
