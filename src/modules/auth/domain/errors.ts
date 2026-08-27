import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '../../../shared/errors/app-error.js';

export class EmailAlreadyRegisteredError extends ConflictError {
  constructor(email: string) {
    super('An account with this email already exists', { email });
  }
}

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('Invalid email or password');
  }
}

export class InvalidRefreshTokenError extends UnauthorizedError {
  constructor() {
    super('Refresh token is invalid, expired, or has been revoked');
  }
}

export class InvalidVerificationTokenError extends UnauthorizedError {
  constructor() {
    super('Verification token is invalid or has expired');
  }
}

export class InvalidPasswordResetTokenError extends UnauthorizedError {
  constructor() {
    super('Password reset token is invalid, expired, or already used');
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found');
  }
}
