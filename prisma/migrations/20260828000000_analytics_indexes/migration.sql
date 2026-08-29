-- CreateIndex
CREATE INDEX "escrows_status_token_idx" ON "escrows"("status", "token");

-- CreateIndex
CREATE INDEX "driver_profiles_tier_idx" ON "driver_profiles"("tier");
