import {
  CONSUMER_IDS,
  processingPolicy,
  requiredConsumersForContract,
} from '../domain/processing-policy.js';
import type { ConsumerId } from '../domain/processing-policy.js';
import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';

export interface BlockedConsumerRegistration {
  id: ConsumerId;
  handler: (event: BlockchainEventEnvelope) => Promise<unknown>;
  blockedBy: readonly string[];
}

/** No handler access or enable flag: registration is never execution approval.
 * A later transactional adapter must establish a separately reviewed capability.
 */
export function createConsumerRegistry(registrations: readonly BlockedConsumerRegistration[]) {
  const entries = new Map<ConsumerId, BlockedConsumerRegistration>();
  for (const entry of registrations) {
    if (!CONSUMER_IDS.includes(entry.id))
      throw new Error(`Unknown event consumer identity: ${entry.id}`);
    if (typeof entry.handler !== 'function')
      throw new Error(`Missing event consumer implementation: ${entry.id}`);
    if (entries.has(entry.id))
      throw new Error(`Duplicate event consumer registration: ${entry.id}`);
    if (entry.blockedBy.length === 0)
      throw new Error(`Recovery prerequisites required: ${entry.id}`);
    entries.set(entry.id, { ...entry, blockedBy: [...entry.blockedBy] });
  }
  function assertRequired(required: readonly ConsumerId[]) {
    const missing = required.filter((id) => !entries.has(id));
    if (missing.length)
      throw new Error(`Missing required event consumer registrations: ${missing.join(', ')}`);
  }
  return Object.freeze({
    assertRequiredRegistrations() {
      assertRequired(CONSUMER_IDS);
    },
    registeredIds(): ConsumerId[] {
      return [...entries.keys()];
    },
    describe() {
      return {
        consumers: CONSUMER_IDS.map((id) => ({
          id,
          implemented: true,
          registered: entries.has(id),
          execution: 'blocked' as const,
          blockedBy: entries.get(id)?.blockedBy.slice() ?? ['missing_registration'],
        })),
        unimplemented: [
          {
            eventType: 'identity-reputation.user_registered',
            consumer: 'users',
            reason: 'users_projection_unresolved',
          },
        ],
        notificationDelivery: 'blocked_ambiguous_outcome_recovery_unverified',
      };
    },
    assertCanProcessContract(contract: string): never {
      const required = requiredConsumersForContract(contract);
      if (required.length === 0)
        throw new Error(`Unresolved event consumer policy for contract: ${contract}`);
      assertRequired(required);
      throw new Error(
        `Event consumer execution blocked for ${contract}: ${required.map((id) => `${id} (${entries.get(id)?.blockedBy.join(', ')})`).join('; ')}`,
      );
    },
    assertCanProcessEvent(event: BlockchainEventEnvelope): never {
      const policy = processingPolicy(event.contractName, event.topic);
      if (policy.required.length === 0)
        throw new Error(`Event processing blocked: ${policy.reason}`);
      assertRequired(policy.required);
      throw new Error(`Event consumer execution blocked: ${policy.required.join(', ')}`);
    },
  });
}
export type ConsumerRegistry = ReturnType<typeof createConsumerRegistry>;
