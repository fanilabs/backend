import { StrKey } from '@stellar/stellar-sdk';
import { z } from 'zod';

/**
 * Stellar Soroban token address: either an Ed25519 public key ('G' + 55 base32 characters)
 * or a contract ID ('C' + 55 base32 characters).
 *
 * On Stellar Soroban, standard payment tokens (such as USDC, wrapped XLM, and custom token
 * contract deployments) have contract addresses starting with 'C'. This validator accepts both
 * forms to support contract-based payments through the REST API.
 *
 * The regex alone only constrains shape (length + alphabet); it does not verify the embedded
 * CRC16-XDR checksum that StrKey uses to detect typos. A shape-valid but checksum-invalid
 * string would otherwise pass route validation and then throw a raw (non-AppError) `Error`
 * deep inside the Soroban SDK, which gets mapped to an unmapped 500 INTERNAL_ERROR. Validating
 * the checksum here keeps every token address that reaches the service layer actually usable,
 * and surfaces malformed addresses as the ordinary 400 VALIDATION_ERROR at the boundary instead.
 */
export const tokenAddress = z
  .string()
  .regex(/^[GC][A-Z2-7]{55}$/, 'Not a valid Stellar token address (must be G... or C...)')
  .refine(
    (value) =>
      (value.startsWith('G') && StrKey.isValidEd25519PublicKey(value)) ||
      (value.startsWith('C') && StrKey.isValidContract(value)),
    {
      message: 'Not a valid Stellar token address (invalid checksum)',
    },
  );
