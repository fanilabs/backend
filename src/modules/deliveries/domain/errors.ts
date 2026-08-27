import { NotFoundError } from '../../../shared/errors/app-error.js';

export class DeliveryNotFoundError extends NotFoundError {
  constructor() {
    super('Delivery not found');
  }
}
