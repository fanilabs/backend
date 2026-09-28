ALTER TABLE "blockchain_checkpoints"
  ALTER COLUMN "contract_name" TYPE VARCHAR(255);

ALTER TABLE "blockchain_events"
  ALTER COLUMN "contract_name" TYPE VARCHAR(255);
