import type { CargoCategory, DeliveryStatus } from '@prisma/client';

export type { CargoCategory, DeliveryStatus };

export interface Delivery {
  id: string;
  chainDeliveryId: bigint;
  senderAddress: string;
  recipientAddress: string;
  driverAddress: string | null;
  status: DeliveryStatus;
  origin: string;
  destination: string;
  cargoCategory: CargoCategory;
  weightGrams: number;
  fragile: boolean;
  createdAtChain: Date;
  transitStartedAt: Date | null;
  deliveredAt: Date | null;
}

/** The full record as read directly off-chain via `get_delivery` — same
 * shape as `Delivery` minus the backend's own local id. */
export type ChainDeliveryRecord = Omit<Delivery, 'id'>;
