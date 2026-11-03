-- Restore the escrow token-policy result introduced in 7ebc2b5, lost at merge.
-- No historical allowlist snapshot exists: unknown rows must not contribute to GMV.
-- Do not infer verification from RELEASED status, token name, or user timestamps.
ALTER TABLE "escrows" ADD COLUMN "is_verified" BOOLEAN NOT NULL DEFAULT false;
