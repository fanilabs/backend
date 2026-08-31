import { NotFoundError } from '../../../shared/errors/app-error.js';

export class EscrowNotFoundError extends NotFoundError {
  constructor() {
    super('Escrow not found');
  }
}
