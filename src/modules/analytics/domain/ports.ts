import type { DeliveryFunnelCounts, DriverTierCounts, GmvByToken } from './entities.js';

/**
 * Aggregates directly over `deliveries`/`escrows`/`disputes`/`driver_profiles`
 * — the tables `deliveries`/`escrow`/`disputes`/`reputation` each own.
 * This is one of the approved cross-module read ports catalogued in
 * `docs/DATABASE.md` ("Approved cross-module read ports"), alongside
 * `notifications/domain/ports.ts`'s `UserContactLookup` and
 * `admin/domain/ports.ts`'s `AdminUserReader`. This module's entire purpose
 * is exactly this kind of read-only cross-module aggregation —
 * `ARCHITECTURE.md` §4 documents it as "computed from read models" — so it
 * isn't a boundary violation to work around here, it's the one thing this
 * module does. No writes anywhere in this module; every query is a
 * `count`/`groupBy`/`sum` (`infrastructure/prisma-analytics-reader.ts`),
 * never a mutation of another module's rows. Ordinary domain/application
 * imports remain subject to the architecture boundary rules.
 */
export interface AnalyticsReader {
  getGmvByToken(): Promise<GmvByToken[]>;
  getDeliveryFunnelCounts(): Promise<DeliveryFunnelCounts>;
  getDriverTierCounts(): Promise<DriverTierCounts>;
}
