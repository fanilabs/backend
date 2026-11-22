-- Issue #466: Explicit referential actions for Escrow/Dispute -> Delivery
-- Recreate the foreign keys with ON DELETE RESTRICT ON UPDATE CASCADE so that
-- deleting a Delivery with an associated Escrow or Dispute is explicitly
-- prevented by the database, regardless of whether the deletion is issued via
-- Prisma Client or raw SQL.

-- Escrow.chainDeliveryId -> Delivery.chainDeliveryId
ALTER TABLE "Escrow" DROP CONSTRAINT IF EXISTS "Escrow_chainDeliveryId_fkey";
ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_chainDeliveryId_fkey"
  FOREIGN KEY ("chainDeliveryId") REFERENCES "Delivery"("chainDeliveryId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dispute.chainDeliveryId -> Delivery.chainDeliveryId
ALTER TABLE "Dispute" DROP CONSTRAINT IF EXISTS "Dispute_chainDeliveryId_fkey";
ALTER TABLE "Dispute"
  ADD CONSTRAINT "Dispute_chainDeliveryId_fkey"
  FOREIGN KEY ("chainDeliveryId") REFERENCES "Delivery"("chainDeliveryId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
