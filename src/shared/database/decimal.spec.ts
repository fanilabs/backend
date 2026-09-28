import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { decimalToBigInt } from './decimal.js';

describe('decimalToBigInt', () => {
  it('converts a small integer Decimal', () => {
    expect(decimalToBigInt(new Prisma.Decimal('42'))).toBe(42n);
  });

  it('converts zero', () => {
    expect(decimalToBigInt(new Prisma.Decimal(0))).toBe(0n);
  });

  it('converts a negative value', () => {
    expect(decimalToBigInt(new Prisma.Decimal('-123456789'))).toBe(-123456789n);
  });

  it('converts an i128::MAX-sized value that .toString() would render exponentially', () => {
    // The bug this helper guards against: Decimal.toString() on a 39-digit
    // value yields "1.7014118346046923e+38", which BigInt() can't parse.
    const i128Max = '170141183460469231731687303715884105727';
    expect(decimalToBigInt(new Prisma.Decimal(i128Max))).toBe(BigInt(i128Max));
  });
});
