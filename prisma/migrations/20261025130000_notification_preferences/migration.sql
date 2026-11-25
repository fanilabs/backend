-- Issue #698: per-user, per-event-type notification preference model.
-- Absence of a row means default-on (notifications enabled).
-- Only an explicit disabled=true row suppresses dispatch.

CREATE TYPE "notification_event_type" AS ENUM (
  'DELIVERY_DRIVER_ASSIGNED',
  'DELIVERY_IN_TRANSIT',
  'DELIVERY_CONFIRMED',
  'DELIVERY_CANCELLED',
  'ESCROW_DELIVERY_DISPUTED',
  'ESCROW_RELEASED',
  'ESCROW_REFUNDED',
  'DISPUTE_RAISED',
  'DISPUTE_RESOLVED_REFUND',
  'DISPUTE_RESOLVED_SPLIT',
  'DISPUTE_RESOLVED_PAYOUT',
  'REPUTATION_DRIVER_REGISTERED',
  'REPUTATION_KYC_STATUS_UPDATED',
  'REPUTATION_INCREASED',
  'REPUTATION_DECREASED',
  'FLEET_REGISTERED',
  'FLEET_DRIVER_INVITED',
  'FLEET_INVITE_ACCEPTED',
  'FLEET_DRIVER_REMOVED'
);

CREATE TABLE "notification_preferences" (
  "id"          TEXT NOT NULL,
  "user_id"     TEXT NOT NULL,
  "event_type"  "notification_event_type" NOT NULL,
  "disabled"    BOOLEAN NOT NULL DEFAULT false,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_user_id_event_type_key"
    UNIQUE ("user_id", "event_type"),
  CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "notification_preferences_user_id_idx"
  ON "notification_preferences" ("user_id");
