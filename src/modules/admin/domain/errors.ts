import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors/app-error.js';

export class AdminUserNotFoundError extends NotFoundError {
  constructor() {
    super('User not found');
  }
}

export class CannotChangeOwnRoleError extends ForbiddenError {
  constructor() {
    super('Cannot change your own role');
  }
}

export class LastAdministratorError extends ConflictError {
  constructor() {
    super('Cannot demote the last administrator');
  }
}
