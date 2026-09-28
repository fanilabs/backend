CREATE INDEX "disputes_status_raised_at_chain_delivery_id_idx"
ON "disputes"("status", "raised_at", "chain_delivery_id");
