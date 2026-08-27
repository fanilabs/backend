import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../../shared/errors/app-error.js';

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found');
  }
}

export class WalletAlreadyLinkedError extends ConflictError {
  constructor(address: string) {
    super('This wallet address is already linked to an account', { address });
  }
}

export class WalletNotFoundError extends NotFoundError {
  constructor() {
    super('Wallet address not found');
  }
}

export class ForbiddenWalletAccessError extends ForbiddenError {
  constructor() {
    super('This wallet address does not belong to the current user');
  }
}

export class InvalidWalletChallengeError extends UnauthorizedError {
  constructor() {
    super('Wallet link challenge is invalid, expired, or does not match the request');
  }
}

export class InvalidWalletSignatureError extends UnauthorizedError {
  constructor() {
    super('Signature does not match the claimed wallet address');
  }
}
