import { NotFoundError } from '../../../shared/errors/app-error.js';

export class DriverProfileNotFoundError extends NotFoundError {
  constructor() {
    super('Driver profile not found');
  }
}
