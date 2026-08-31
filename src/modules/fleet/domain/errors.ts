import { NotFoundError } from '../../../shared/errors/app-error.js';

export class FleetNotFoundError extends NotFoundError {
  constructor() {
    super('Fleet not found');
  }
}

export class DriverFleetRecordNotFoundError extends NotFoundError {
  constructor() {
    super('No fleet-membership record found for this driver');
  }
}
