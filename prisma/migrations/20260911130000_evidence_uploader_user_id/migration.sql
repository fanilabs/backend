-- AlterTable
-- Additive, nullable: existing evidence rows keep uploaded_by_user_id = NULL
-- (no historical data destroyed or reassigned) — see Evidence.uploadedByUserId's
-- doc comment (prisma/schema.prisma) for why downloadEvidence treats that as
-- an explicit legacy case rather than guessing an owner.
ALTER TABLE "evidence" ADD COLUMN "uploaded_by_user_id" TEXT;

-- CreateIndex
CREATE INDEX "evidence_uploaded_by_user_id_idx" ON "evidence"("uploaded_by_user_id");

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
