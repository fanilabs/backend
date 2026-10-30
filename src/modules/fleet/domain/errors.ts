import { AppError } from '../../../shared/errors/app-error.js';

export class FleetNotFoundError extends AppError {
  constructor(message = 'Fleet not found') {
    super(message, 404, 'FLEET_NOT_FOUND');
  }
}

export class DriverPayoutAddressNotFoundError extends AppError {
  readonly statusCode = 404;
  readonly code = 'DRIVER_NOT_FOUND';

  constructor(message = 'Driver payout address not found') {
    super(message);
  }
}
