import { describe, expect, it } from 'vitest';
import { createGetDisputeUseCase } from '../../modules/disputes/application/get-dispute.js';
import { createGetDeliveryUseCase } from '../../modules/deliveries/application/get-delivery.js';
import { createGetEscrowUseCase } from '../../modules/escrow/application/get-escrow.js';
import { createGetFleetUseCase } from '../../modules/fleet/application/get-fleet.js';
import { createGetDriverProfileUseCase } from '../../modules/reputation/application/get-driver-profile.js';
import {
  createGetNotificationUseCase,
  createListNotificationsUseCase,
} from '../../modules/notifications/application/index.js';
import { createGetMyProfileUseCase } from '../../modules/users/application/get-my-profile.js';
import { createListAuditLogUseCase } from '../../modules/admin/application/list-audit-log.js';

/**
 * A rejected repository call must propagate as a rejection all the way out
 * of a read use case — never get caught and turned into a false
 * not-found (`null`) or an empty successful list/page (#671). Every case
 * below rejects with this exact sentinel so the assertion can check
 * identity, proving nothing re-wrapped or swallowed it along the way.
 */
const REPOSITORY_OUTAGE = new Error('simulated repository outage');

function rejecting() {
  return async () => {
    throw REPOSITORY_OUTAGE;
  };
}

describe('read use cases propagate repository failures instead of swallowing them (#671)', () => {
  it('getDispute propagates a rejected disputeRepository lookup', async () => {
    const getDispute = createGetDisputeUseCase({
      disputeRepository: { findByChainDeliveryId: rejecting() } as never,
      evidenceRepository: {} as never,
      contractReader: {} as never,
    });

    await expect(getDispute({ chainDeliveryId: 1n })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('getDelivery propagates a rejected deliveryRepository lookup', async () => {
    const getDelivery = createGetDeliveryUseCase({
      deliveryRepository: { findByChainId: rejecting() } as never,
    });

    await expect(getDelivery({ chainDeliveryId: 1n })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('getEscrow propagates a rejected escrowRepository lookup', async () => {
    const getEscrow = createGetEscrowUseCase({
      escrowRepository: { findByChainDeliveryId: rejecting() } as never,
    });

    await expect(getEscrow({ chainDeliveryId: 1n })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('getFleet propagates a rejected fleetRepository lookup', async () => {
    const getFleet = createGetFleetUseCase({
      fleetRepository: { findByChainFleetId: rejecting() } as never,
    });

    await expect(getFleet({ chainFleetId: 1n })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('getDriverProfile propagates a rejected driverProfileRepository lookup', async () => {
    const getDriverProfile = createGetDriverProfileUseCase({
      driverProfileRepository: { findByAddress: rejecting() } as never,
    });

    await expect(getDriverProfile({ address: 'GDRIVER' })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('getNotification propagates a rejected notificationRepository lookup', async () => {
    const getNotification = createGetNotificationUseCase({
      notificationRepository: { findById: rejecting() } as never,
    });

    await expect(
      getNotification({ userId: 'user-1', notificationId: 'n-1' }),
    ).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('listNotifications propagates a rejected notificationRepository listByUserId call', async () => {
    const listNotifications = createListNotificationsUseCase({
      notificationRepository: { listByUserId: rejecting() } as never,
    });

    await expect(listNotifications({ userId: 'user-1' })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('getMyProfile propagates a rejected userReader lookup', async () => {
    const getMyProfile = createGetMyProfileUseCase({
      userReader: { findById: rejecting() } as never,
      walletAddressRepository: {} as never,
    });

    await expect(getMyProfile({ userId: 'user-1' })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('listAuditLog propagates a rejected findMany query (audit list)', async () => {
    const listAuditLog = createListAuditLogUseCase({
      prisma: {
        auditLog: {
          findMany: rejecting(),
          count: async () => 0,
        },
      } as never,
    });

    await expect(listAuditLog({ includeTotal: true })).rejects.toBe(REPOSITORY_OUTAGE);
  });

  it('listAuditLog propagates a rejected count query (audit count)', async () => {
    const listAuditLog = createListAuditLogUseCase({
      prisma: {
        auditLog: {
          findMany: async () => [],
          count: rejecting(),
        },
      } as never,
    });

    await expect(listAuditLog({ includeTotal: true, page: 1 })).rejects.toBe(REPOSITORY_OUTAGE);
  });
});
