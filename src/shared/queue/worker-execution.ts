/**
 * Fixed execution restriction for the current binary, shared by worker logs
 * and queue status. No environment setting can enable these jobs. See
 * docs/DEPLOYMENT.md: activation requires reviewed recovery/safety evidence.
 * This module has no queue, database, timer or service construction effects.
 */
export const workerExecutionStatus = Object.freeze({
  status: 'blocked' as const,
  jobs: Object.freeze([
    Object.freeze({
      queue: 'blockchain-indexer',
      status: 'blocked' as const,
      reason: 'consumer_completion_and_checkpoint_recovery_unverified',
    }),
    Object.freeze({
      queue: 'notifications',
      status: 'blocked' as const,
      reason: 'delivery_outbox_and_ambiguous_send_recovery_unverified',
    }),
    Object.freeze({
      queue: 'fraud-activity-cleanup',
      status: 'blocked' as const,
      reason: 'safe_retention_frontier_and_bounded_deletion_unverified',
    }),
  ]),
});
