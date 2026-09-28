ALTER TABLE "deliveries"
ALTER COLUMN "recipient_address" TYPE VARCHAR(56);

ALTER TABLE "escrows"
ALTER COLUMN "recipient_address" TYPE VARCHAR(56);
