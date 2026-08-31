import type { CargoCategory, ChainDeliveryRecord, Delivery, DeliveryStatus } from './entities.js';

export interface DeliveryFilter {
  senderAddress?: string;
  recipientAddress?: string;
  driverAddress?: string;
  status?: DeliveryStatus;
}

export interface DeliveryStatusPatch {
  status: DeliveryStatus;
  driverAddress?: string;
  transitStartedAt?: Date;
  deliveredAt?: Date;
}

/**
 * The read model — written exclusively by `syncDeliveryFromEvent` reacting
 * to confirmed on-chain events (never by an API request assuming a
 * transaction will succeed — ARCHITECTURE.md §9 / docs/EVENT_INDEXER.md).
 */
export interface DeliveryRepository {
  findByChainId(chainDeliveryId: bigint): Promise<Delivery | null>;
  list(filter: DeliveryFilter): Promise<Delivery[]>;
  create(record: ChainDeliveryRecord): Promise<Delivery>;
  updateStatus(chainDeliveryId: bigint, patch: DeliveryStatusPatch): Promise<void>;
}

/**
 * `delivery_contract`'s `delivery_created` event only carries
 * `(delivery_id, sender)` — no origin/destination/cargo metadata
 * (PHASE_1_DOMAIN_ANALYSIS.md §4) — so hydrating a full local record
 * requires this supplementary read-only contract call, not just the event.
 */
export interface DeliveryContractReader {
  getDelivery(chainDeliveryId: bigint): Promise<ChainDeliveryRecord>;
}

export interface CreateDeliveryTxInput {
  senderAddress: string;
  recipientAddress: string;
  origin: string;
  destination: string;
  cargoCategory: CargoCategory;
  weightGrams: number;
  fragile: boolean;
  estimatedDelivery: Date;
}

export interface AssignDriverTxInput {
  callerAddress: string;
  chainDeliveryId: bigint;
  driverAddress: string;
}

export interface DeliveryIdTxInput {
  chainDeliveryId: bigint;
}

export interface MarkInTransitTxInput extends DeliveryIdTxInput {
  driverAddress: string;
}

export interface ConfirmDeliveryTxInput extends DeliveryIdTxInput {
  recipientAddress: string;
}

export interface CancelDeliveryTxInput extends DeliveryIdTxInput {
  senderAddress: string;
}

export interface RaiseDisputeTxInput extends DeliveryIdTxInput {
  callerAddress: string;
}

/**
 * Builds unsigned XDR for each `delivery_contract` call reviewed in
 * PHASE_1_DOMAIN_ANALYSIS.md §4 — this backend never signs these; it only
 * builds them for the caller's own wallet (ARCHITECTURE.md §2/§9).
 */
export interface DeliveryTransactionBuilder {
  buildCreateDelivery(input: CreateDeliveryTxInput): Promise<string>;
  buildAssignDriver(input: AssignDriverTxInput): Promise<string>;
  buildMarkInTransit(input: MarkInTransitTxInput): Promise<string>;
  buildConfirmDelivery(input: ConfirmDeliveryTxInput): Promise<string>;
  buildCancelDelivery(input: CancelDeliveryTxInput): Promise<string>;
  buildRaiseDispute(input: RaiseDisputeTxInput): Promise<string>;
}
