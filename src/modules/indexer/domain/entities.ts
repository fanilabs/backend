export interface Checkpoint {
  contractName: string;
  network: string;
  lastLedgerSeq: bigint;
  updatedAt: Date;
}

/** A raw event as returned by Soroban RPC, decoded from XDR but not yet
 * interpreted as any particular business event — that interpretation is
 * each consuming module's job (ARCHITECTURE.md §6). */
export interface RawContractEvent {
  contractId: string;
  /** The Soroban RPC's own globally-unique, monotonic event id. */
  rpcEventId: string;
  ledgerSeq: number;
  txHash: string;
  topic: string[];
  value: unknown;
  closedAt: Date;
}

export interface StoredEvent {
  contractName: string;
  network: string;
  rpcEventId: string;
  ledgerSeq: bigint;
  txHash: string;
  topic: string[];
  payload: unknown;
  /** When this actually happened on-chain (ledger close time), not when
   * this backend ingested it — consuming modules that need an on-chain
   * timestamp (e.g. `deliveries` recording `deliveredAt`) use this rather
   * than `new Date()` at processing time. */
  closedAt: Date;
}
