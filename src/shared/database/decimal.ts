import type { Prisma } from '@prisma/client';

/**
 * Converts a Prisma `Decimal` to a `BigInt`.
 *
 * Prisma's Decimal (decimal.js) switches to exponential notation past 21
 * significant digits by default — `.toString()` on an i128::MAX-sized amount
 * (39 digits; the columns are `Decimal(39, 0)`, see prisma/schema.prisma)
 * yields "1.7...e+38", which `BigInt()` can't parse. `.toFixed()` always
 * returns a plain fixed-point string regardless of magnitude, so Decimal
 * amounts must be converted to BigInt via `.toFixed()`, never `.toString()`.
 */
export function decimalToBigInt(value: Prisma.Decimal): bigint {
  return BigInt(value.toFixed());
}
