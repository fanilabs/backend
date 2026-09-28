import type { BlockchainEventEnvelope } from '../../../shared/events/index.js';
import { parseAddress, parseBigIntId } from '../../../shared/events/index.js';
import type {
  DisputeEscrowStateReader,
  DisputeRepository,
  WalletOwnershipRepository,
} from '../domain/index.js';

export interface SyncDisputeFromEventDeps {
  disputeRepository: DisputeRepository;
  escrowStateReader: DisputeEscrowStateReader;
  /** Used exactly once per dispute, only from the `dispute_raised`/
   * `delivery_disputed` handlers below, to resolve `raisedByUserId` at the
   * moment a dispute is first observed — see `WalletOwnershipRepository.
   * findOwnerByAddress`'s and `DisputeRepository.upsert`'s doc comments for
   * why this is safe to resolve on every event (including replays) without
   * re-checking whether the row already exists first. */
  walletOwnershipRepository: WalletOwnershipRepository;
}

/**
 * Reacts to **both** layers of the on-chain dispute system into one
 * `Dispute` row per `chainDeliveryId` (PHASE_1_DOMAIN_ANALYSIS.md §5):
 *
 *  - `dispute_resolution_contract` ("Layer B", contractName `dispute-resolution`)
 *    — `dispute_raised`, `dispute_resolved_refund`, `dispute_resolved_split`,
 *    `dispute_resolved_payout`. `evidence_added` is intentionally a no-op
 *    here (see below). This is the authoritative signal for status whenever
 *    it fires.
 *  - `escrow_contract` ("Layer A", contractName `escrow`) —
 *    `delivery_disputed` and `dispute_resolved`. `dispute_resolved` is
 *    ambiguous by itself: both of `resolve_dispute`'s branches (and
 *    `resolve_dispute_split`) emit that identical event (verified against
 *    `escrow_contract/lib.rs`, same fact the `escrow` module's own handler
 *    documents), so — mirroring that handler's own `get_escrow` fallback —
 *    this one reads the escrow's current on-chain status via
 *    `DisputeEscrowStateReader` and maps it to a resolved dispute status.
 *    This only ever *sets* a resolution when the dispute is still `OPEN`:
 *    a Layer B resolution, once recorded, is authoritative and is never
 *    overwritten by a later Layer A event (see `handleEscrowEvent` below).
 *
 * Both `dispute_raised` and `delivery_disputed` can arrive first depending
 * on which on-chain path raised the dispute (verified against
 * `dispute_resolution_contract::raise_dispute`, which calls
 * `escrow_contract.raise_dispute` — emitting Layer A's event — *before*
 * creating its own `DisputeCase` and emitting Layer B's), so every write
 * here is an idempotent upsert (`DisputeRepository.upsert`), never an
 * assumed create-then-update sequence.
 *
 * `dispute_resolution_contract`'s `delivery_id` parameter is the
 * tuple/newtype `DeliveryId` struct (`shared_types::DeliveryId(pub u64)`),
 * **not** the bare `u64` `escrow_contract` uses — verified directly against
 * `dispute_resolution_contract/lib.rs`, where every `publish()` call passes
 * `delivery_id` (the struct) straight through. `BlockchainEventEnvelope.topic`
 * is always `string[]` (`indexer/infrastructure/soroban-event-source.ts`
 * JSON-stringifies any non-string topic segment), so a tuple-wrapped id
 * arrives as the JSON string `'["1"]'`, not a native array — `parseTupleWrappedDeliveryId`
 * below parses it accordingly. Getting this backwards would silently fail
 * every Layer B event lookup.
 *
 * Whichever of `dispute_raised`/`delivery_disputed` first creates the
 * `Dispute` row also resolves `raisedByUserId` (security: raiser
 * wallet-relink evidence authorization, follow-up to
 * `Evidence.uploadedByUserId`) from that same event's address, via
 * `WalletOwnershipRepository.findOwnerByAddress` — passed the *event's own*
 * `closedAt`, never wall-clock "now". This is the only point in the whole
 * system that ever sets it — see `DisputeRepository.upsert`'s doc comment
 * for why the repository itself refuses to let a later event (replay, or
 * resolution) reassign it once set. That alone isn't sufficient, though:
 * the indexer resumes from a checkpoint after any downtime
 * (`poll-contract-events.ts`), so a `dispute_raised` event can be processed
 * for the *first* time long after it actually happened on-chain — if
 * "current wallet owner" were resolved using wall-clock time at processing
 * time rather than the event's own `closedAt`, a wallet relinked in that
 * gap would wrongly resolve to the new owner on first creation, not just
 * on a later replay. `findOwnerByAddress`'s `asOf` parameter closes that.
 */
export function createSyncDisputeFromEventUseCase(deps: SyncDisputeFromEventDeps) {
  return async function syncDisputeFromEvent(event: BlockchainEventEnvelope): Promise<void> {
    if (event.contractName === 'dispute-resolution') {
      return handleDisputeResolutionEvent(deps, event);
    }
    if (event.contractName === 'escrow') {
      return handleEscrowEvent(deps, event);
    }
  };
}

async function handleDisputeResolutionEvent(
  deps: SyncDisputeFromEventDeps,
  event: BlockchainEventEnvelope,
): Promise<void> {
  const eventName = event.topic[0];
  const chainDeliveryId = parseTupleWrappedDeliveryId(event.topic[1]);
  if (chainDeliveryId === null) return;

  const payload = Array.isArray(event.payload) ? event.payload : [];

  switch (eventName) {
    case 'dispute_raised': {
      const raisedBy = parseAddress(payload[0]);
      if (raisedBy === null) return;
      const raisedByUserId = await deps.walletOwnershipRepository.findOwnerByAddress(
        raisedBy,
        event.closedAt,
      );
      await deps.disputeRepository.upsert(chainDeliveryId, {
        status: 'OPEN',
        raisedBy,
        raisedAt: event.closedAt,
        ...(raisedByUserId !== null && { raisedByUserId }),
      });
      return;
    }

    case 'dispute_resolved_refund': {
      const caller = parseAddress(payload[0]);
      await upsertResolution(deps, chainDeliveryId, 'RESOLVED_REFUND', caller, event.closedAt);
      return;
    }

    case 'dispute_resolved_split': {
      const caller = parseAddress(payload[0]);
      // payload: (caller, delivery_id, sender_share_bps) — the only
      // on-chain source for the confirmed split ratio (backend issue #40);
      // `DisputeCase` itself has no such field (PHASE_1_DOMAIN_ANALYSIS.md
      // §5). Malformed/out-of-range values are dropped rather than trusted,
      // same posture as this file's other payload parsing.
      const senderShareBps = parseSenderShareBps(payload[2]);
      await upsertResolution(deps, chainDeliveryId, 'SPLIT', caller, event.closedAt, {
        ...(senderShareBps !== null && { senderShareBps }),
      });
      return;
    }

    case 'dispute_resolved_payout': {
      const caller = parseAddress(payload[0]);
      await upsertResolution(deps, chainDeliveryId, 'RESOLVED_PAYOUT', caller, event.closedAt);
      return;
    }

    case 'evidence_added':
      // No read-model row to update — `Evidence` rows are created solely by
      // the `uploadEvidence` use case at upload time (application/upload-evidence.ts),
      // and cross-checked against the chain's `evidence_hashes` at read time
      // (application/get-dispute.ts), not written here.
      return;

    default:
      // A future addition this handler doesn't know about yet — ignored,
      // not an error (docs/EVENT_INDEXER.md's malformed/unknown-event
      // handling).
      return;
  }
}

async function handleEscrowEvent(
  deps: SyncDisputeFromEventDeps,
  event: BlockchainEventEnvelope,
): Promise<void> {
  // escrow_contract's own delivery_id convention: a bare u64 in the topic,
  // not the tuple-wrapped DeliveryId dispute_resolution_contract uses —
  // verified against escrow_contract/lib.rs (same convention the `escrow`
  // module's own handler relies on).
  const chainDeliveryId = parseBigIntId(event.topic[1]);
  if (chainDeliveryId === null) return;

  if (event.topic[0] === 'delivery_disputed') {
    const disputedBy = parseAddress(Array.isArray(event.payload) ? event.payload[0] : undefined);
    if (disputedBy === null) return;

    const raisedByUserId = await deps.walletOwnershipRepository.findOwnerByAddress(
      disputedBy,
      event.closedAt,
    );

    // A dispute row raised purely via Layer A (no dispute_resolution_contract
    // case ever created) should still exist and be visible — create it as
    // OPEN if this is the first event either layer has produced for it.
    await deps.disputeRepository.upsert(chainDeliveryId, {
      status: 'OPEN',
      raisedBy: disputedBy,
      raisedAt: event.closedAt,
      ...(raisedByUserId !== null && { raisedByUserId }),
    });
    return;
  }

  if (event.topic[0] === 'dispute_resolved') {
    await handleEscrowOnlyResolution(deps, chainDeliveryId, event.closedAt);
  }
}

/**
 * A dispute resolved purely via `escrow_contract`'s Layer A, without
 * `dispute_resolution_contract` ever touching it (see this file's header
 * comment). `escrow.dispute_resolved` alone can't say whether the outcome
 * was a release or a refund — the same ambiguity `escrow`'s own handler
 * resolves with a supplementary `get_escrow` read — so this reads the
 * escrow's current status and maps it accordingly.
 *
 * Only ever applied when the dispute is still `OPEN`: if a Layer B
 * resolution already landed (or a prior Layer A one did), that value is
 * authoritative and is left untouched — this never re-derives or
 * overwrites an existing resolution.
 */
async function handleEscrowOnlyResolution(
  deps: SyncDisputeFromEventDeps,
  chainDeliveryId: bigint,
  resolvedAt: Date,
): Promise<void> {
  const existing = await deps.disputeRepository.findByChainDeliveryId(chainDeliveryId);
  if (existing !== null && existing.status !== 'OPEN') return;

  if (existing === null) {
    // A dispute_resolved event with no prior raise recorded at all (neither
    // Layer A's delivery_disputed nor Layer B's dispute_raised) — nothing
    // to resolve, and no raisedBy to record it against. Out-of-order/
    // replayed event, not expected on the happy path.
    console.warn(
      `[disputes] escrow.dispute_resolved observed for chainDeliveryId=${chainDeliveryId} with no prior dispute raised — skipping.`,
    );
    return;
  }

  const escrowStatus = await deps.escrowStateReader.getEscrowStatus(chainDeliveryId);

  if (escrowStatus === 'RELEASED') {
    await deps.disputeRepository.upsert(chainDeliveryId, {
      status: 'RESOLVED_PAYOUT',
      raisedBy: existing.raisedBy,
      raisedAt: existing.raisedAt,
      resolvedAt,
    });
    return;
  }

  if (escrowStatus === 'REFUNDED') {
    await deps.disputeRepository.upsert(chainDeliveryId, {
      status: 'RESOLVED_REFUND',
      raisedBy: existing.raisedBy,
      raisedAt: existing.raisedAt,
      resolvedAt,
    });
    return;
  }

  // LOCKED/PAUSED — dispute_resolved fired but the escrow hasn't actually
  // settled from this read's point of view (a race with indexing, or an
  // on-chain state this handler doesn't expect). Leave it OPEN rather than
  // guess.
  console.warn(
    `[disputes] escrow.dispute_resolved observed for chainDeliveryId=${chainDeliveryId} but escrow status is "${escrowStatus}" — leaving dispute OPEN.`,
  );
}

async function upsertResolution(
  deps: SyncDisputeFromEventDeps,
  chainDeliveryId: bigint,
  status: 'RESOLVED_REFUND' | 'RESOLVED_PAYOUT' | 'SPLIT',
  resolvedBy: string | null,
  resolvedAt: Date,
  extra: { senderShareBps?: number } = {},
): Promise<void> {
  const existing = await deps.disputeRepository.findByChainDeliveryId(chainDeliveryId);

  // A resolution event always implies a prior raise — but this column is
  // read downstream as a Stellar address (including as an authorisation
  // subject in downloadEvidence), so it must never fall back to a
  // non-address sentinel. If this handler somehow observes a resolution
  // out of order (e.g. a reprocessed/replayed batch) with neither a known
  // prior raiser nor a caller address on the resolution itself, there is
  // nothing valid to write — skip the upsert rather than poison the column.
  const raisedBy = existing?.raisedBy ?? resolvedBy;
  if (raisedBy === null) {
    console.warn(
      `[disputes] ${status} resolution observed for chainDeliveryId=${chainDeliveryId} with no known raiser (no prior raise, no caller address) — skipping.`,
    );
    return;
  }

  await deps.disputeRepository.upsert(chainDeliveryId, {
    status,
    raisedBy,
    raisedAt: existing?.raisedAt ?? resolvedAt,
    ...(resolvedBy !== null && { resolvedBy }),
    resolvedAt,
    ...extra,
  });
}

/** `sender_share_bps` is a `u32` on-chain, `≤ 10000` per
 * `resolve_dispute_split_funds`'s own precondition
 * (PHASE_1_DOMAIN_ANALYSIS.md §3) — a confirmed event is already validated
 * by the contract, but this still drops anything malformed/out-of-range
 * rather than trust it blindly, same posture as `parseAmount`/`parseAddress`
 * elsewhere in this codebase. */
function parseSenderShareBps(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) return null;
  return parsed;
}

/** `topic[1]` for a tuple-wrapped `DeliveryId` arrives as the JSON string
 * `'["1"]'`, not a native array — see this file's header comment. */
function parseTupleWrappedDeliveryId(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) return null;
  return parseBigIntId(parsed[0]);
}
