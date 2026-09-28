import type {
  DisputeRepository,
  EvidenceRepository,
  EvidenceStorage,
  UserRole,
  WalletOwnershipRepository,
} from '../domain/index.js';
import { EvidenceNotFoundError, ForbiddenEvidenceAccessError } from '../domain/index.js';

export interface DownloadEvidenceDeps {
  evidenceRepository: EvidenceRepository;
  evidenceStorage: EvidenceStorage;
  disputeRepository: DisputeRepository;
  walletOwnershipRepository: WalletOwnershipRepository;
}

export interface DownloadEvidenceInput {
  evidenceId: string;
  requesterId: string;
  requesterRole: UserRole;
}

export interface DownloadEvidenceResult {
  contentType: string;
  bytes: Buffer;
}

/**
 * Phase 6 security review finding: this previously had no access check at
 * all beyond "is authenticated" — any registered user could download any
 * dispute's evidence file given only its id, itself discoverable via the
 * public `GET /disputes/:chainDeliveryId` (which lists every evidence
 * item's id). Now restricted to `ADMIN`, whoever uploaded the item, or
 * whoever raised the dispute it belongs to — the raiser can review
 * evidence the other party submitted, not just their own.
 *
 * Wallet-relink evidence authorization (a later security review finding):
 * the uploader check above originally re-derived "who currently owns the
 * `uploadedBy` *address*" via `WalletOwnershipRepository` on every
 * download. That's wrong for historical authorization — if the original
 * uploader's wallet link later ends and a *different* user links that same
 * address, `isOwnedByUser(newUser, sameAddress)` now returns true, and the
 * new owner would inherit access to evidence they had nothing to do with.
 * Fixed for the uploader branch by authorizing against
 * `evidence.uploadedByUserId` — the uploader's account id, captured once
 * at upload time (`uploadEvidence`) and never re-derived from current
 * wallet state — whenever it's set. Only evidence uploaded before that
 * column existed has it `null`; for that legacy case only, this falls back
 * to the old current-wallet-ownership check (a narrower, explicitly-scoped
 * residual gap for pre-existing rows, not a general fallback for new data).
 *
 * Raiser wallet-relink evidence authorization (a follow-up security review
 * finding, closing the residual gap the previous fix explicitly flagged):
 * the raiser branch previously had the identical problem — it authorized
 * against *current* wallet ownership of `dispute.raisedBy`, so a wallet
 * unlinked from the original raiser and relinked by a different user would
 * transfer raiser-based evidence access to them too. Fixed by authorizing
 * against `dispute.raisedByUserId` instead — resolved once, in
 * `sync-dispute-from-event.ts`, at the moment the dispute is first
 * observed (see that field's doc comment, prisma/schema.prisma, and
 * `DisputeRepository.upsert`'s for why it can never be reassigned
 * afterward), never re-derived from wallet state at download time.
 *
 * Unlike the uploader branch, there is deliberately **no** current-wallet-
 * ownership fallback here, not even for disputes with no `raisedByUserId`
 * (no account owned `raisedBy` when the dispute was first observed, or the
 * dispute was synced before this field existed): falling back to current
 * ownership would just be the vulnerable check wearing a different name.
 * Such a dispute's evidence remains reachable via the uploader branch and
 * `ADMIN`, just not via "I currently hold the raiser's wallet."
 */
export function createDownloadEvidenceUseCase(deps: DownloadEvidenceDeps) {
  return async function downloadEvidence(
    input: DownloadEvidenceInput,
  ): Promise<DownloadEvidenceResult> {
    const evidence = await deps.evidenceRepository.findById(input.evidenceId);
    if (!evidence) {
      throw new EvidenceNotFoundError();
    }

    if (input.requesterRole !== 'ADMIN') {
      const dispute = await deps.disputeRepository.findById(evidence.disputeId);
      const ownsUploader =
        evidence.uploadedByUserId !== null
          ? evidence.uploadedByUserId === input.requesterId
          : await deps.walletOwnershipRepository.isOwnedByUser(
              input.requesterId,
              evidence.uploadedBy,
            );
      // No current-wallet-ownership fallback for a missing raisedByUserId —
      // see this function's doc comment.
      const ownsRaiser = dispute?.raisedByUserId === input.requesterId;
      if (!ownsUploader && !ownsRaiser) {
        throw new ForbiddenEvidenceAccessError();
      }
    }

    const bytes = await deps.evidenceStorage.read(evidence.storageUrl);
    return { contentType: evidence.contentType, bytes };
  };
}
