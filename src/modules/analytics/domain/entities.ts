export interface GmvByToken {
  token: string;
  releasedAmount: bigint;
  releasedCount: number;
}

export interface DeliveryFunnelCounts {
  totalDeliveries: number;
  deliveredCount: number;
  disputedCount: number;
}

export interface DriverTierCounts {
  bronze: number;
  silver: number;
  gold: number;
}
