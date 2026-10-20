import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

/**
 * Stellar (Soroban) public key: 'G' + 55 base32 characters.
 *
 * The regex alone only constrains shape (length + alphabet); it does not
 * verify the embedded CRC16-XDR checksum that StrKey uses to detect typos.
 * A shape-valid but checksum-invalid string would otherwise pass route
 * validation and then throw a raw (non-AppError) `Error` from
 * `new Address(address)` deep inside `addressToScVal`, which handleError's
 * final generic branch maps to an unmapped 500 INTERNAL_ERROR. Validating
 * the checksum here keeps every Stellar address that reaches the service
 * layer actually usable, and surfaces malformed addresses as the ordinary
 * 400 VALIDATION_ERROR at the boundary instead.
 */
export const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Not a valid Stellar public key')
  .refine((value) => StrKey.isValidEd25519PublicKey(value), {
    message: 'Not a valid Stellar public key',
  });

/**
 * Accepts either a Stellar Ed25519 account public key (`G...`) or a Soroban
 * contract address (`C...`), verifying the CRC16-XDR checksum via StrKey.
 */
export const stellarContractOrAccountAddress = z
  .string()
  .regex(/^[GC][A-Z2-7]{55}$/, 'Not a valid Stellar account or contract address')
  .refine(
    (value) =>
      value.startsWith('G')
        ? StrKey.isValidEd25519PublicKey(value)
        : StrKey.isValidContract(value),
    {
      message: 'Not a valid Stellar account or contract address',
    },
  );
