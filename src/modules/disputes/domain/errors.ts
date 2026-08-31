import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';

export class DisputeNotFoundError extends NotFoundError {
  constructor() {
    super('Dispute not found');
  }
}

export class EvidenceNotFoundError extends NotFoundError {
  constructor() {
    super('Evidence not found');
  }
}

/** Mirrors `add_evidence_hash`'s on-chain guard (`dispute.status != Open` ->
 * `InvalidState`, PHASE_1_DOMAIN_ANALYSIS.md §5) — evidence can only be
 * attached while a dispute is still open, on-chain and here alike. */
export class DisputeNotOpenError extends ConflictError {
  constructor() {
    super('Evidence can only be added to an open dispute');
  }
}

/** Closes a real gap found in Phase 6's security review: without this,
 * any authenticated user could upload arbitrary file content to any open
 * dispute, falsely attributed to any address. */
export class ForbiddenEvidenceUploadError extends ForbiddenError {
  constructor() {
    super('You can only upload evidence attributed to a wallet you own');
  }
}

/** Closes the other half of the same finding: without this, evidence
 * download had no ownership check at all — any authenticated user could
 * download any dispute's evidence given only its id (itself discoverable
 * via the public `GET /disputes/:chainDeliveryId`, which lists every
 * evidence item's id). */
export class ForbiddenEvidenceAccessError extends ForbiddenError {
  constructor() {
    super('You do not have access to this evidence');
  }
}
