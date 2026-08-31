-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CUSTOMER', 'COURIER', 'FLEET_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('PENDING', 'ACTIVE', 'IN_TRANSIT', 'DELIVERED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "cargo_category" AS ENUM ('DOCUMENTS', 'ELECTRONICS', 'PERISHABLES', 'CLOTHING', 'GENERAL');

-- CreateEnum
CREATE TYPE "escrow_status" AS ENUM ('LOCKED', 'RELEASED', 'REFUNDED', 'PAUSED');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('OPEN', 'RESOLVED_REFUND', 'RESOLVED_PAYOUT', 'SPLIT');

-- CreateEnum
CREATE TYPE "fleet_driver_status" AS ENUM ('PENDING', 'ACTIVE');

-- CreateEnum
CREATE TYPE "driver_tier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "user_role" NOT NULL DEFAULT 'CUSTOMER',
    "email_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "chain_delivery_id" BIGINT NOT NULL,
    "sender_address" TEXT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "driver_address" TEXT,
    "status" "delivery_status" NOT NULL DEFAULT 'PENDING',
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "cargo_category" "cargo_category" NOT NULL,
    "weight_grams" INTEGER NOT NULL,
    "fragile" BOOLEAN NOT NULL DEFAULT false,
    "created_at_chain" TIMESTAMP(3) NOT NULL,
    "transit_started_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escrows" (
    "id" TEXT NOT NULL,
    "chain_delivery_id" BIGINT NOT NULL,
    "sender_address" TEXT NOT NULL,
    "recipient_address" TEXT NOT NULL,
    "driver_address" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "amount" DECIMAL(39,0) NOT NULL,
    "platform_fee" DECIMAL(39,0),
    "status" "escrow_status" NOT NULL DEFAULT 'LOCKED',
    "disputed_by" TEXT,
    "disputed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at_chain" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "chain_delivery_id" BIGINT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'OPEN',
    "raised_by" TEXT NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "sender_share_bps" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" TEXT NOT NULL,
    "dispute_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "storage_url" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleets" (
    "id" TEXT NOT NULL,
    "chain_fleet_id" BIGINT NOT NULL,
    "owner_id" TEXT,
    "owner_address" TEXT NOT NULL,
    "treasury_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fleets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fleet_drivers" (
    "id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "driver_address" TEXT NOT NULL,
    "status" "fleet_driver_status" NOT NULL DEFAULT 'PENDING',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "fleet_drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "reputation_score" INTEGER NOT NULL DEFAULT 50,
    "tier" "driver_tier" NOT NULL DEFAULT 'BRONZE',
    "kyc_verified" BOOLEAN NOT NULL DEFAULT false,
    "deliveries_completed" INTEGER NOT NULL DEFAULT 0,
    "legacy_deliveries_completed" INTEGER NOT NULL DEFAULT 0,
    "registered_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_checkpoints" (
    "id" TEXT NOT NULL,
    "contract_name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "last_ledger_seq" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blockchain_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_events" (
    "id" TEXT NOT NULL,
    "contract_name" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "rpc_event_id" TEXT NOT NULL,
    "ledger_seq" BIGINT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "topic" TEXT[],
    "payload" JSONB NOT NULL,
    "ledger_closed_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "blockchain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_addresses_address_key" ON "wallet_addresses"("address");

-- CreateIndex
CREATE INDEX "wallet_addresses_user_id_idx" ON "wallet_addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_chain_delivery_id_key" ON "deliveries"("chain_delivery_id");

-- CreateIndex
CREATE INDEX "deliveries_sender_address_idx" ON "deliveries"("sender_address");

-- CreateIndex
CREATE INDEX "deliveries_recipient_address_idx" ON "deliveries"("recipient_address");

-- CreateIndex
CREATE INDEX "deliveries_driver_address_idx" ON "deliveries"("driver_address");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "escrows_chain_delivery_id_key" ON "escrows"("chain_delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_chain_delivery_id_key" ON "disputes"("chain_delivery_id");

-- CreateIndex
CREATE INDEX "evidence_dispute_id_idx" ON "evidence"("dispute_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleets_chain_fleet_id_key" ON "fleets"("chain_fleet_id");

-- CreateIndex
CREATE UNIQUE INDEX "fleet_drivers_fleet_id_driver_address_key" ON "fleet_drivers"("fleet_id", "driver_address");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_address_key" ON "driver_profiles"("address");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_checkpoints_contract_name_network_key" ON "blockchain_checkpoints"("contract_name", "network");

-- CreateIndex
CREATE INDEX "blockchain_events_contract_name_ledger_seq_idx" ON "blockchain_events"("contract_name", "ledger_seq");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_events_contract_name_network_rpc_event_id_key" ON "blockchain_events"("contract_name", "network", "rpc_event_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "notifications_status_idx" ON "notifications"("status");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escrows" ADD CONSTRAINT "escrows_chain_delivery_id_fkey" FOREIGN KEY ("chain_delivery_id") REFERENCES "deliveries"("chain_delivery_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_chain_delivery_id_fkey" FOREIGN KEY ("chain_delivery_id") REFERENCES "deliveries"("chain_delivery_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fleet_drivers" ADD CONSTRAINT "fleet_drivers_fleet_id_fkey" FOREIGN KEY ("fleet_id") REFERENCES "fleets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
