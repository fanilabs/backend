-- Observations are retained atomically with new raw events. No historical
-- backfill: configuration is not evidence of the origin of an old event.
CREATE TABLE "event_contract_observations" (
  "event_id" TEXT NOT NULL PRIMARY KEY,
  "contract_id" TEXT NOT NULL,
  CONSTRAINT "event_contract_observations_event_id_fkey" FOREIGN KEY ("event_id")
    REFERENCES "blockchain_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
