import { AppError, ConflictError, NotFoundError } from '../../../shared/errors/app-error.js';

export class FleetNotFoundError extends NotFoundError {
  constructor(message = 'Fleet not found') {
    super(message);
  }
}

export class DriverFleetRecordNotFoundError extends NotFoundError {
  constructor() {
    super('No fleet-membership record found for this driver');
  }
}

export class DriverAlreadyInFleetError extends ConflictError {
  constructor(driverAddress: string, chainFleetId: bigint) {
    super(`Driver ${driverAddress} is already active in fleet ${chainFleetId}`);
  }
}

export class DriverPayoutAddressNotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'DRIVER_NOT_FOUND';

  constructor(message = 'Driver payout address not found') {
    super(message);
  }
}
