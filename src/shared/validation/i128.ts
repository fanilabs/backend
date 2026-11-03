import { ValidationError } from '../errors/app-error.js';

export const I128_MIN = -(1n << 127n);
export const I128_MAX = (1n << 127n) - 1n;

export function assertI128(value: bigint): void {
  if (value < I128_MIN || value > I128_MAX) {
    throw new ValidationError('Value must be within signed 128-bit bounds');
  }
}

export function assertEscrowAmount(value: bigint): void {
  if (value <= 0n) throw new ValidationError('Escrow amount must be greater than zero');
  assertI128(value);
}
