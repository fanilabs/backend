-- Enforce the single-primary-wallet invariant at the database level.
--
-- `confirmWalletLink` decides "should this newly linked wallet be primary?"
-- by checking `findByUserId(...).length === 0` and then creating the row.
-- Two concurrent confirmations for the same brand-new user can both observe
-- zero wallets and both create a row with is_primary = true.
--
-- A plain UNIQUE(user_id, is_primary) can't express the rule (it would also
-- forbid a user's second is_primary = false wallet). A Postgres partial
-- unique index does exactly what we want: any number of is_primary = false
-- rows per user, at most one is_primary = true. Prisma's schema DSL has no
-- syntax for a partial (filtered) unique index, so this lives only in this
-- hand-written migration -- see the note on the WalletAddress model in
-- prisma/schema.prisma.
CREATE UNIQUE INDEX "wallet_addresses_user_id_primary_key"
  ON "wallet_addresses" ("user_id")
  WHERE "is_primary";

-- Track modification time on wallet addresses (issue #183).
--
-- `WalletAddress` had no `updatedAt` field, so auditability and any
-- modification-time-based cache invalidation were impossible. The column is
-- added with a default so existing rows are backfilled to the migration time
-- rather than failing the NOT NULL constraint; Prisma's `@updatedAt` keeps it
-- current on every subsequent write.
ALTER TABLE "wallet_addresses"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
