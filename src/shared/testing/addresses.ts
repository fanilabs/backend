import { Keypair } from '@stellar/stellar-sdk';

/**
 * Deterministic, checksum-valid Stellar addresses for tests.
 *
 * `parseAddress` (`src/shared/events/parse.ts`) rejects anything that isn't
 * a real G/M/C StrKey, so placeholder strings like `'GDRIVER'` can no longer
 * be used wherever an event-payload address flows through a handler. Deriving
 * from a label-seeded keypair keeps fixtures readable —
 * `testAddress('driver')` — while remaining a genuinely valid address
 * (labels are copied into a fixed 32-byte seed, so keep them ≤ 32 bytes of
 * UTF-8 — not 32 characters, since multi-byte characters take more than one
 * byte each).
 */
export function testAddress(label: string): string {
  const encoded = Buffer.from(label, 'utf8');
  if (encoded.byteLength > 32) {
    throw new Error(
      `testAddress label "${label}" is ${encoded.byteLength} UTF-8 bytes, exceeding the 32-byte seed — labels sharing the first 32 bytes would otherwise silently collide on the same address`,
    );
  }
  const seed = Buffer.alloc(32);
  encoded.copy(seed);
  return Keypair.fromRawEd25519Seed(seed).publicKey();
}
