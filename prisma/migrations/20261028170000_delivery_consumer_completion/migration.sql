-- Additive only: no historical completion or ordering provenance is inferred.
CREATE TABLE "event_consumer_completions" (
  "event_id" TEXT NOT NULL,
  "consumer_id" TEXT NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("event_id", "consumer_id"),
  CONSTRAINT "event_consumer_completions_obligation_fkey" FOREIGN KEY ("event_id", "consumer_id")
    REFERENCES "event_consumer_obligations"("event_id", "consumer_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "delivery_consumer_positions" (
  "chain_delivery_id" BIGINT NOT NULL PRIMARY KEY,
  "network" TEXT NOT NULL,
  "last_ledger_seq" BIGINT NOT NULL CHECK ("last_ledger_seq" >= 0),
  CONSTRAINT "delivery_consumer_positions_delivery_fkey" FOREIGN KEY ("chain_delivery_id")
    REFERENCES "deliveries"("chain_delivery_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
