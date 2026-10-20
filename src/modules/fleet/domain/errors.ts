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

export class DriverNotFoundError extends NotFoundError {
  constructor() {
    super('Driver not found on-chain');
  }
}
