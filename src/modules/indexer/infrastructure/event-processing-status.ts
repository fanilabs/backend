import type { ConsumerId } from '../domain/processing-policy.js';
import type { PrismaClient } from '@prisma/client';

/** Read-only admission status. A legacy processedAt is never trusted here.
 * No listener count, empty obligation list or resolved publish implies success.
 */
export async function eventProcessingStatus(
  prisma: PrismaClient,
  eventId: string,
  registered: readonly ConsumerId[] = [],
) {
  const events = await prisma.blockchainEvent.findUnique({ where: { id: eventId } });
  if (!events) throw new Error(`Blockchain event not found: ${eventId}`);
  const receipts = await prisma.$queryRaw<
    Array<{ policy_version: number; blocked_reason: string }>
  >`
    SELECT policy_version, blocked_reason FROM event_processing_receipts WHERE event_id = ${eventId}`;
  const receipt = receipts[0];
  if (!receipt) return { status: 'historical_unknown' as const, complete: false as const };
  const obligations = await prisma.$queryRaw<
    Array<{ consumer_id: string; blocked_reason: string }>
  >`
    SELECT consumer_id, blocked_reason FROM event_consumer_obligations
    WHERE event_id = ${eventId} ORDER BY consumer_id`;
  const registeredIds = new Set<string>(registered);
  return {
    status: 'blocked' as const,
    complete: false as const,
    policyVersion: receipt.policy_version,
    reason: receipt.blocked_reason,
    obligations,
    missingRegistrations: obligations
      .filter((row) => !registeredIds.has(row.consumer_id))
      .map((row) => row.consumer_id),
  };
}
