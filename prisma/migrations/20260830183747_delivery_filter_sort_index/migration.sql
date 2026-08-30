-- DropIndex
DROP INDEX "deliveries_status_idx";

-- CreateIndex
CREATE INDEX "deliveries_status_created_at_chain_idx" ON "deliveries"("status", "created_at_chain" DESC);
