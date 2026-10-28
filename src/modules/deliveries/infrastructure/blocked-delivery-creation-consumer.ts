import type { PrismaClient } from '@prisma/client';
import { StrKey } from '@stellar/stellar-sdk';
import { inspectCreationPayload } from '../application/creation-evidence.js';

export interface ExpectedDeliveryOrigin {
  network: string;
  contractId: string;
}

/** No current-state reader or caller-supplied "trusted snapshot" is accepted.
 * This slice has no independently verified archival/deployed-ABI adapter. Keep
 * each admitted creation visibly blocked, durably, without modifying projections,
 * provenance positions, completion, raw processedAt or checkpoints.
 */
export function createBlockedDeliveryCreationConsumer(
  prisma: PrismaClient,
  expected: ExpectedDeliveryOrigin,
) {
  if (!expected.network.trim() || !StrKey.isValidContract(expected.contractId)) {
    throw new Error('A valid expected delivery network/contract identity is required');
  }
  const origin = { ...expected };
  return async (eventId: string) =>
    prisma.$transaction(
      async (tx) => {
        const obligations = await tx.$queryRaw<Array<{ blocked_reason: string }>>`
      SELECT o.blocked_reason FROM event_consumer_obligations o
      JOIN event_processing_receipts r ON r.event_id = o.event_id
      WHERE o.event_id = ${eventId} AND o.consumer_id = 'deliveries' AND r.policy_version = 1
      FOR UPDATE OF o`;
        const obligation = obligations[0];
        if (!obligation)
          throw new Error('Deliveries obligation unavailable; historical completion stays unknown');
        const raw = await tx.blockchainEvent.findUniqueOrThrow({ where: { id: eventId } });
        if (
          raw.contractName !== 'delivery' ||
          raw.topic.length !== 1 ||
          raw.topic[0] !== 'delivery_created'
        ) {
          throw new Error('Not a delivery_created event; creation guard cannot process it');
        }
        const completed = await tx.$queryRaw<Array<{ event_id: string }>>`
      SELECT event_id FROM event_consumer_completions WHERE event_id = ${eventId} AND consumer_id = 'deliveries'`;
        if (completed.length) return { outcome: 'already_completed' as const, eventId };
        const observations = await tx.$queryRaw<Array<{ contract_id: string }>>`
      SELECT contract_id FROM event_contract_observations WHERE event_id = ${eventId}`;
        const observed = observations[0]?.contract_id;
        const payload = inspectCreationPayload(raw.payload);
        let reason: string;
        if (!payload || raw.ledgerSeq < 1n || !Number.isFinite(raw.ledgerClosedAt.getTime())) {
          reason = 'delivery_creation_payload_or_ledger_invalid';
        } else if (raw.network !== origin.network) {
          reason = 'delivery_creation_network_mismatch';
        } else if (!observed || !StrKey.isValidContract(observed)) {
          reason = 'delivery_creation_contract_provenance_missing';
        } else if (observed !== origin.contractId) {
          reason = 'delivery_creation_contract_mismatch';
        } else {
          reason = 'delivery_creation_deployed_abi_and_historical_state_unverified';
        }
        if (obligation.blocked_reason !== reason) {
          await tx.$executeRaw`UPDATE event_consumer_obligations SET blocked_reason = ${reason}
        WHERE event_id = ${eventId} AND consumer_id = 'deliveries'`;
        }
        return { outcome: 'blocked' as const, eventId, reason };
      },
      { isolationLevel: 'ReadCommitted' },
    );
}
