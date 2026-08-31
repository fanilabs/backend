-- CreateEnum
CREATE TYPE "actor_activity_category" AS ENUM ('DELIVERY_CREATED', 'ESCROW_RELEASED', 'DISPUTE_RAISED');

-- CreateTable
CREATE TABLE "actor_activities" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "category" "actor_activity_category" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actor_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "actor_activities_address_category_occurred_at_idx" ON "actor_activities"("address", "category", "occurred_at");
