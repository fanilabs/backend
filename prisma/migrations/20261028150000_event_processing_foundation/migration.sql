-- Additive admission metadata only. Existing events deliberately remain without
-- a receipt: their historical completion is UNKNOWN, never inferred or replayed.
CREATE TABLE "event_processing_receipts" (
  "event_id" TEXT NOT NULL PRIMARY KEY,
  "policy_version" INTEGER NOT NULL CHECK ("policy_version" > 0),
  "blocked_reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "event_processing_receipts_event_id_fkey" FOREIGN KEY ("event_id")
    REFERENCES "blockchain_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "event_consumer_obligations" (
  "event_id" TEXT NOT NULL,
  "consumer_id" TEXT NOT NULL,
  "blocked_reason" TEXT NOT NULL,
  PRIMARY KEY ("event_id", "consumer_id"),
  CONSTRAINT "event_consumer_obligations_event_id_fkey" FOREIGN KEY ("event_id")
    REFERENCES "event_processing_receipts"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- No completion column/API or replay runner in this prerequisite. Every
-- admitted obligation is durably blocked until a verified consumer adapter lands.
