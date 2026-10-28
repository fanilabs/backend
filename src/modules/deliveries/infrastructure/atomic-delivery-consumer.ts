import { parseBigIntId } from '../../../shared/events/parse.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { deliveryMutation } from '../application/delivery-mutation.js';
import { DeliveryNotFoundError } from '../domain/errors.js';
import { createTransactionalDeliveryRepository } from './prisma-delivery-repository.js';

/** Manually address one admitted obligation by durable identity. Not wired to
 * production execution/replay: M11 coverage, pinned creation hydration and
 * legacy projection reconciliation are still required. No network effects.
 */
export function createAtomicDeliveryStatusConsumer(prisma: PrismaClient) {
  return async (eventId: string): Promise<'completed' | 'already_completed'> =>
    prisma.$transaction(
      async (tx) => {
        // Lock one consumer obligation, not all consumers of this event. Policy v1
        // is explicitly supported; a future policy needs its own compatibility review.
        const obligations = await tx.$queryRaw<Array<{ event_id: string }>>`
      SELECT o.event_id FROM event_consumer_obligations o
      JOIN event_processing_receipts r ON r.event_id = o.event_id
      WHERE o.event_id = ${eventId} AND o.consumer_id = 'deliveries' AND r.policy_version = 1
      FOR UPDATE OF o`;
        if (!obligations.length)
          throw new Error('Deliveries obligation unavailable; historical completion stays unknown');
        const completed = await tx.$queryRaw<Array<{ event_id: string }>>`
      SELECT event_id FROM event_consumer_completions WHERE event_id = ${eventId} AND consumer_id = 'deliveries'`;
        if (completed.length) return 'already_completed';
        const raw = await tx.blockchainEvent.findUniqueOrThrow({ where: { id: eventId } });
        if (raw.contractName === 'delivery' && raw.topic[0] === 'delivery_created') {
          throw new Error('delivery_created blocked: event-time hydration snapshot is unavailable');
        }
        const mutation = deliveryMutation({
          ...raw,
          payload: raw.payload,
          closedAt: raw.ledgerClosedAt,
        });
        if (!mutation) throw new Error('Unsupported or malformed delivery mutation; not completed');
        // Existing projection key is global chainDeliveryId. Bind proven ordering
        // state to one network and reject other networks rather than mix their effects.
        const delivery = await tx.$queryRaw<Array<{ chain_delivery_id: bigint }>>`
      SELECT chain_delivery_id FROM deliveries WHERE chain_delivery_id = ${mutation.chainDeliveryId} FOR UPDATE`;
        if (!delivery.length) throw new DeliveryNotFoundError();
        const positions = await tx.$queryRaw<Array<{ network: string; last_ledger_seq: bigint }>>`
      SELECT network, last_ledger_seq FROM delivery_consumer_positions WHERE chain_delivery_id = ${mutation.chainDeliveryId}`;
        const position = positions[0];
        if (!position)
          throw new Error('Delivery ordering provenance unavailable; reconciliation required');
        if (position.network !== raw.network) throw new Error('Delivery ordering network mismatch');
        if (raw.ledgerSeq <= position.last_ledger_seq)
          throw new Error('Stale or same-ledger delivery event; ordering unresolved');
        // Do not skip an earlier known, uncompleted event of this same aggregate.
        // Use the existing ID parser, including supported numeric/string encodings.
        // Bound this ordering probe; never infer absence from a truncated scan.
        // Coverage of not-yet-received events remains M11, not a global watermark.
        const pending = await tx.$queryRaw<Array<{ id: string; payload: Prisma.JsonValue }>>`
      SELECT e.id, e.payload FROM blockchain_events e
      LEFT JOIN event_consumer_completions c ON c.event_id = e.id AND c.consumer_id = 'deliveries'
      WHERE e.contract_name = 'delivery' AND e.network = ${raw.network}
        AND e.ledger_seq > ${position.last_ledger_seq} AND e.ledger_seq <= ${raw.ledgerSeq}
        AND e.id <> ${eventId} AND c.event_id IS NULL
      LIMIT 1001`;
        if (pending.length > 1000)
          throw new Error('Delivery ordering probe budget exceeded; coverage unresolved');
        if (
          pending.some(
            (event) =>
              parseBigIntId(Array.isArray(event.payload) ? event.payload[0] : undefined) ===
              mutation.chainDeliveryId,
          )
        ) {
          throw new Error('Earlier or same-ledger delivery event incomplete');
        }
        const repository = createTransactionalDeliveryRepository(tx);
        await repository.updateStatus(mutation.chainDeliveryId, mutation.patch);
        await tx.$executeRaw`
      UPDATE delivery_consumer_positions SET last_ledger_seq = ${raw.ledgerSeq}
      WHERE chain_delivery_id = ${mutation.chainDeliveryId}`;
        await tx.$executeRaw`
      INSERT INTO event_consumer_completions (event_id, consumer_id) VALUES (${eventId}, 'deliveries')`;
        // Never set raw processedAt or advance a checkpoint: other consumers and
        // completeness of ingestion have not been established by this transaction.
        return 'completed';
      },
      { isolationLevel: 'ReadCommitted' },
    );
}
