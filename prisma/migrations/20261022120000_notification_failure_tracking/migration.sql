-- AlterTable
ALTER TABLE "notifications"
ADD COLUMN "failure_reason" TEXT,
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;