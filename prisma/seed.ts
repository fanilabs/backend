import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

/**
 * Local-development seed. Populates a small, coherent dataset covering every
 * read model (deliveries, escrows, disputes, fleets, driver profiles,
 * notifications, audit logs) so a new contributor can exercise every GET
 * endpoint without a live Soroban deployment emitting events. All writes are
 * upserts keyed on natural unique columns, so running this twice is safe.
 *
 * Deliberately refuses to run against NODE_ENV=production — this data
 * (including a well-known admin password) must never land in a real
 * deployment's database.
 */

const SALT_ROUNDS = 10;

// Development-only credentials. Loudly not for production use.
const SEED_ADMIN_EMAIL = 'admin@fanilab.dev';
const SEED_ADMIN_PASSWORD = 'DevAdmin123!';
const SEED_CUSTOMER_EMAIL = 'customer@fanilab.dev';
const SEED_CUSTOMER_PASSWORD = 'DevCustomer123!';

const ADMIN_WALLET = 'GADMIN0000000000000000000000000000000000000000000A';
const CUSTOMER_WALLET = 'GCUSTOMER00000000000000000000000000000000000000000B';
const DRIVER_WALLET_1 = 'GDRIVER100000000000000000000000000000000000000000C';
const DRIVER_WALLET_2 = 'GDRIVER200000000000000000000000000000000000000000D';
const DRIVER_WALLET_3 = 'GDRIVER300000000000000000000000000000000000000000E';
const FLEET_TREASURY = 'GTREASURY0000000000000000000000000000000000000000F';

// Deterministic ids so re-running the seed upserts the same rows instead of
// growing the table on every run.
const IDS = {
  evidenceOpen: '00000000-0000-0000-0000-000000000001',
  notificationSent: '00000000-0000-0000-0000-000000000002',
  notificationPending: '00000000-0000-0000-0000-000000000003',
  notificationFailed: '00000000-0000-0000-0000-000000000004',
  auditRoleChange: '00000000-0000-0000-0000-000000000005',
  auditKyc: '00000000-0000-0000-0000-000000000006',
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[seed] Refusing to run with NODE_ENV=production.');
  }

  const prisma = new PrismaClient();
  try {
    console.warn('[seed] Seeding development data. This includes known, non-production credentials:');
    console.warn(`[seed]   ADMIN    ${SEED_ADMIN_EMAIL} / ${SEED_ADMIN_PASSWORD}`);
    console.warn(`[seed]   CUSTOMER ${SEED_CUSTOMER_EMAIL} / ${SEED_CUSTOMER_PASSWORD}`);
    console.warn('[seed] Never reuse these credentials outside a local/dev database.');

    const [adminPasswordHash, customerPasswordHash] = await Promise.all([
      bcrypt.hash(SEED_ADMIN_PASSWORD, SALT_ROUNDS),
      bcrypt.hash(SEED_CUSTOMER_PASSWORD, SALT_ROUNDS),
    ]);

    const admin = await prisma.user.upsert({
      where: { email: SEED_ADMIN_EMAIL },
      update: {},
      create: {
        email: SEED_ADMIN_EMAIL,
        passwordHash: adminPasswordHash,
        role: 'ADMIN',
        emailVerifiedAt: new Date(),
      },
    });

    const customer = await prisma.user.upsert({
      where: { email: SEED_CUSTOMER_EMAIL },
      update: {},
      create: {
        email: SEED_CUSTOMER_EMAIL,
        passwordHash: customerPasswordHash,
        role: 'CUSTOMER',
        emailVerifiedAt: new Date(),
      },
    });

    await prisma.walletAddress.upsert({
      where: { address: ADMIN_WALLET },
      update: {},
      create: { userId: admin.id, address: ADMIN_WALLET, isPrimary: true, verifiedAt: new Date() },
    });

    await prisma.walletAddress.upsert({
      where: { address: CUSTOMER_WALLET },
      update: {},
      create: { userId: customer.id, address: CUSTOMER_WALLET, isPrimary: true, verifiedAt: new Date() },
    });

    // ── Deliveries — one per DeliveryStatus ──────────────────────────────
    const deliveryFixtures = [
      { chainDeliveryId: 1n, status: 'PENDING' as const, driverAddress: null },
      { chainDeliveryId: 2n, status: 'ACTIVE' as const, driverAddress: DRIVER_WALLET_1 },
      { chainDeliveryId: 3n, status: 'IN_TRANSIT' as const, driverAddress: DRIVER_WALLET_1 },
      { chainDeliveryId: 4n, status: 'DELIVERED' as const, driverAddress: DRIVER_WALLET_2 },
      { chainDeliveryId: 5n, status: 'DISPUTED' as const, driverAddress: DRIVER_WALLET_2 },
      { chainDeliveryId: 6n, status: 'CANCELLED' as const, driverAddress: null },
    ];

    for (const fixture of deliveryFixtures) {
      await prisma.delivery.upsert({
        where: { chainDeliveryId: fixture.chainDeliveryId },
        update: {},
        create: {
          chainDeliveryId: fixture.chainDeliveryId,
          senderAddress: CUSTOMER_WALLET,
          recipientAddress: CUSTOMER_WALLET,
          driverAddress: fixture.driverAddress,
          status: fixture.status,
          origin: 'Lagos, NG',
          destination: 'Abuja, NG',
          cargoCategory: 'GENERAL',
          weightGrams: 2_500,
          fragile: false,
          createdAtChain: new Date(),
        },
      });
    }

    // ── Escrows — one per EscrowStatus, linked to a delivery above ──────
    const escrowFixtures = [
      { chainDeliveryId: 2n, status: 'LOCKED' as const },
      { chainDeliveryId: 4n, status: 'RELEASED' as const },
      { chainDeliveryId: 6n, status: 'REFUNDED' as const },
      { chainDeliveryId: 3n, status: 'PAUSED' as const },
    ];

    for (const fixture of escrowFixtures) {
      await prisma.escrow.upsert({
        where: { chainDeliveryId: fixture.chainDeliveryId },
        update: {},
        create: {
          chainDeliveryId: fixture.chainDeliveryId,
          senderAddress: CUSTOMER_WALLET,
          recipientAddress: CUSTOMER_WALLET,
          driverAddress: DRIVER_WALLET_1,
          token: 'USDC',
          amount: 10_000_000n,
          platformFee: 250_000n,
          status: fixture.status,
          createdAtChain: new Date(),
        },
      });
    }

    // ── Disputes — dedicated deliveries so every DisputeStatus is covered ──
    const disputeDeliveryIds = [101n, 102n, 103n, 104n];
    for (const chainDeliveryId of disputeDeliveryIds) {
      await prisma.delivery.upsert({
        where: { chainDeliveryId },
        update: {},
        create: {
          chainDeliveryId,
          senderAddress: CUSTOMER_WALLET,
          recipientAddress: CUSTOMER_WALLET,
          driverAddress: DRIVER_WALLET_3,
          status: 'DISPUTED',
          origin: 'Accra, GH',
          destination: 'Kumasi, GH',
          cargoCategory: 'ELECTRONICS',
          weightGrams: 1_200,
          fragile: true,
          createdAtChain: new Date(),
        },
      });
    }

    const disputeFixtures = [
      { chainDeliveryId: 101n, status: 'OPEN' as const },
      { chainDeliveryId: 102n, status: 'RESOLVED_REFUND' as const },
      { chainDeliveryId: 103n, status: 'RESOLVED_PAYOUT' as const },
      { chainDeliveryId: 104n, status: 'SPLIT' as const },
    ];

    const disputes = [];
    for (const fixture of disputeFixtures) {
      const dispute = await prisma.dispute.upsert({
        where: { chainDeliveryId: fixture.chainDeliveryId },
        update: {},
        create: {
          chainDeliveryId: fixture.chainDeliveryId,
          status: fixture.status,
          raisedBy: CUSTOMER_WALLET,
          raisedAt: new Date(),
          resolvedBy: fixture.status === 'OPEN' ? null : ADMIN_WALLET,
          resolvedAt: fixture.status === 'OPEN' ? null : new Date(),
          senderShareBps: fixture.status === 'SPLIT' ? 5_000 : null,
        },
      });
      disputes.push(dispute);
    }

    const openDispute = disputes.find((dispute) => dispute.status === 'OPEN');
    if (openDispute) {
      await prisma.evidence.upsert({
        where: { id: IDS.evidenceOpen },
        update: {},
        create: {
          id: IDS.evidenceOpen,
          disputeId: openDispute.id,
          hash: 'a'.repeat(64),
          storageUrl: 'file://storage/evidence/seed-photo.jpg',
          contentType: 'image/jpeg',
          uploadedBy: CUSTOMER_WALLET,
        },
      });
    }

    // ── Fleet — one fleet, drivers covering each FleetDriverStatus ──────
    const fleet = await prisma.fleet.upsert({
      where: { chainFleetId: 1n },
      update: {},
      create: {
        chainFleetId: 1n,
        ownerId: admin.id,
        ownerAddress: ADMIN_WALLET,
        treasuryAddress: FLEET_TREASURY,
      },
    });

    await prisma.fleetDriver.upsert({
      where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress: DRIVER_WALLET_1 } },
      update: {},
      create: { fleetId: fleet.id, driverAddress: DRIVER_WALLET_1, status: 'ACTIVE', acceptedAt: new Date() },
    });

    await prisma.fleetDriver.upsert({
      where: { fleetId_driverAddress: { fleetId: fleet.id, driverAddress: DRIVER_WALLET_2 } },
      update: {},
      create: { fleetId: fleet.id, driverAddress: DRIVER_WALLET_2, status: 'PENDING' },
    });

    // ── Driver profiles — one per DriverTier ────────────────────────────
    const driverProfileFixtures = [
      { address: DRIVER_WALLET_1, tier: 'GOLD' as const, score: 92, completed: 41, kyc: true },
      { address: DRIVER_WALLET_2, tier: 'SILVER' as const, score: 68, completed: 12, kyc: true },
      { address: DRIVER_WALLET_3, tier: 'BRONZE' as const, score: 50, completed: 0, kyc: false },
    ];

    for (const fixture of driverProfileFixtures) {
      await prisma.driverProfile.upsert({
        where: { address: fixture.address },
        update: {},
        create: {
          address: fixture.address,
          reputationScore: fixture.score,
          tier: fixture.tier,
          kycVerified: fixture.kyc,
          deliveriesCompleted: fixture.completed,
          registeredAt: new Date(),
        },
      });
    }

    // ── Notifications — covering each NotificationStatus ────────────────
    await prisma.notification.upsert({
      where: { id: IDS.notificationSent },
      update: {},
      create: {
        id: IDS.notificationSent,
        userId: customer.id,
        channel: 'EMAIL',
        type: 'delivery.status_changed',
        payload: { deliveryId: '4', status: 'DELIVERED' },
        status: 'SENT',
        sentAt: new Date(),
      },
    });

    await prisma.notification.upsert({
      where: { id: IDS.notificationPending },
      update: {},
      create: {
        id: IDS.notificationPending,
        userId: customer.id,
        channel: 'PUSH',
        type: 'delivery.status_changed',
        payload: { deliveryId: '3', status: 'IN_TRANSIT' },
        status: 'PENDING',
      },
    });

    await prisma.notification.upsert({
      where: { id: IDS.notificationFailed },
      update: {},
      create: {
        id: IDS.notificationFailed,
        userId: customer.id,
        channel: 'SMS',
        type: 'dispute.opened',
        payload: { disputeId: openDispute?.id ?? 'unknown' },
        status: 'FAILED',
      },
    });

    // ── Audit logs ───────────────────────────────────────────────────────
    await prisma.auditLog.upsert({
      where: { id: IDS.auditRoleChange },
      update: {},
      create: {
        id: IDS.auditRoleChange,
        actorId: admin.id,
        actorLabel: SEED_ADMIN_EMAIL,
        action: 'user.role_changed',
        entityType: 'User',
        entityId: customer.id,
        metadata: { from: 'CUSTOMER', to: 'CUSTOMER' },
      },
    });

    await prisma.auditLog.upsert({
      where: { id: IDS.auditKyc },
      update: {},
      create: {
        id: IDS.auditKyc,
        actorId: admin.id,
        actorLabel: SEED_ADMIN_EMAIL,
        action: 'driver.kyc_verified',
        entityType: 'DriverProfile',
        entityId: DRIVER_WALLET_1,
        metadata: { verified: true },
      },
    });

    console.warn('[seed] Done — every read model now has demonstrable rows.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[seed] Failed:', error);
  process.exitCode = 1;
});
