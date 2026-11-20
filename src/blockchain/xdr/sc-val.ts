import { Address, Keypair, nativeToScVal, scValToNative as sdkScValToNative, xdr } from '@stellar/stellar-sdk';

/**
 * Converts a native value to a Soroban `ScVal`.
 *
 * @param value - The native value to convert.
 * @returns The corresponding `ScVal`.
 */
export function nativeToScVal(value: unknown): xdr.ScVal {
  return nativeToScVal(value);
}

/**
 * Converts a Soroban `ScVal` to a native value.
 *
 * @param scVal - The `ScVal` to convert.
 * @returns The corresponding native value.
 */
export function scValToNative(scVal: xdr.ScVal): unknown {
  return sdkScValToNative(scVal);
}

/**
 * Converts a `u32` to a Soroban `ScVal`.
 *
 * @param value - The `u32` value to convert.
 * @returns The corresponding `ScVal`.
 */
export function u32ToScVal(value: number): xdr.ScVal {
  return xdr.ScVal.scvU32(value);
}

/**
 * Converts a `u64` to a Soroban `ScVal`.
 *
 * @param value - The `u64` value to convert.
 * @returns The corresponding `ScVal`.
 */
export function u64ToScVal(value: bigint): xdr.ScVal {
  return xdr.ScVal.scvU64(new xdr.Uint64(value));
}

/**
 * Converts a `bool` to a Soroban `ScVal`.
 *
 * @param value - The `bool` value to convert.
 * @returns The corresponding `ScVal`.
 */
export function boolToScVal(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

/**
 * Converts a `string` to a Soroban `ScVal`.
 *
 * @param value - The `string` value to convert.
 * @returns The corresponding `ScVal`.
 */
export function stringToScVal(value: string): xdr.ScVal {
  return xdr.ScVal.scvString(value);
}

/**
 * Converts a `symbol` to a Soroban `ScVal`.
 *
 * @param value - The `symbol` value to convert.
 * @returns The corresponding `ScVal`.
 */
export function symbolToScVal(value: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(value);
}

/**
 * Converts a Stellar address to a Soroban `ScVal`.
 *
 * @param value - The Stellar address to convert.
 * @returns The corresponding `ScVal`.
 */
export function addressToScVal(value: string): xdr.ScVal {
  return new Address(value).toScVal();
}

/**
 * Combines two 64-bit words into a single 128-bit integer string.
 *
 * @param hi - The high 64-bit word.
 * @param lo - The low 64-bit word.
 * @returns The combined 128-bit integer as a string.
 */
function combine128(hi: bigint, lo: bigint): string {
  return (hi * 2n ** 64n + lo).toString();
}

/**
 * Converts a `i128` to a Soroban `ScVal`.
 *
 * @param value - The `i128` value to convert.
 * @returns The corresponding `ScVal`.
 * @throws {RangeError} If the value is outside the signed 128-bit range.
 */
export function i128ToScVal(value: bigint): xdr.ScVal {
  const min = -(1n << 127n);
  const max = (1n << 127n) - 1n;
  if (value < min || value > max) {
    throw new RangeError(
      `i128ToScVal: value ${value.toString()} is outside the signed 128-bit range [${min.toString()}, ${max.toString()}]`,
    );
  }
  const mask64 = (1n << 64n) - 1n;
  const lo = value & mask64;
  const hi = value >> 64n;
  return xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: new xdr.Int64(hi), lo: new xdr.Uint64(lo) }));
}

/**
 * Converts a tuple/newtype struct to a Soroban `ScVal`.
 *
 * @param value - The inner `ScVal` value.
 * @returns The corresponding `ScVal`.
 */
export function tupleStructToScVal(value: xdr.ScVal): xdr.ScVal {
  return xdr.ScVal.scvVec([value]);
}

/**
 * Converts a unit-variant enum to a Soroban `ScVal`.
 *
 * @param name - The enum variant name.
 * @returns The corresponding `ScVal`.
 */
export function unitEnumToScVal(name: string): xdr.ScVal {
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]);
}

/**
 * Converts a named-field struct to a Soroban `ScVal`.
 *
 * @param fields - The struct fields.
 * @returns The corresponding `ScVal`.
 */
export function namedStructToScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map((key) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key] }));
  return xdr.ScVal.scvMap(entries);
}
