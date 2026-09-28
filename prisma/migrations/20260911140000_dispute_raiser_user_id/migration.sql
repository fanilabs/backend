-- AlterTable
-- Additive, nullable: existing dispute rows keep raised_by_user_id = NULL —
-- we cannot safely determine who owned `raised_by` at the historical moment
-- each existing dispute was raised (only its *current* owner, if any, which
-- is exactly the vulnerable signal this migration exists to stop trusting),
-- so no backfill is attempted. See Dispute.raisedByUserId's doc comment
-- (prisma/schema.prisma) and downloadEvidence's for how that NULL case is
-- handled (conservatively — never falls back to current wallet ownership).
ALTER TABLE "disputes" ADD COLUMN "raised_by_user_id" TEXT;

-- CreateIndex
CREATE INDEX "disputes_raised_by_user_id_idx" ON "disputes"("raised_by_user_id");

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_user_id_fkey" FOREIGN KEY ("raised_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
