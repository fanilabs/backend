import type { PrismaClient } from '@prisma/client';
import type { DeliveryPartyLookup } from '../domain/index.js';

/**
 * Reads `deliveries`' own table directly — see `domain/ports.ts`'s
 * `DeliveryPartyLookup` header comment for why that's the same documented
 * exception `UserContactLookup` already establishes for this module.
 */
export function createPrismaDeliveryPartyLookup(prisma: PrismaClient): DeliveryPartyLookup {
  return {
    async findParties(chainDeliveryId) {
      const delivery = await prisma.delivery.findUnique({
        where: { chainDeliveryId: BigInt(chainDeliveryId) },
        select: { senderAddress: true, recipientAddress: true, driverAddress: true },
      });
      if (!delivery) return null;
      return {
        sender: delivery.senderAddress,
        recipient: delivery.recipientAddress,
        driver: delivery.driverAddress,
      };
    },
  };
}
