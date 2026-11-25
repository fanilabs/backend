import { randomBytes } from 'node:crypto';

/**
 * Collision-resistant chain ID allocator for test fixtures.
 *
 * Production chain IDs are on-chain BigInt values. Tests need unique IDs
 * that:
 *   - Are nonnegative and within Prisma's BigInt (int8) range (< 2^63).
 *   - Never collide across parallel test workers even with a fixed clock.
 *   - Are traceable back to a test run for cleanup.
 *
 * Strategy: derive a 40-bit per-run namespace from crypto.randomBytes so
 * two workers running at the same millisecond get different namespaces.
 * Within a run, a monotonic counter occupies the low 20 bits. The combined
 * 60-bit value fits comfortably in a signed int8.
 *
 *   [ 40-bit namespace | 20-bit counter ]
 *
 * Capacity: 2^20 = 1 048 576 IDs per test run.
 * Namespace collision probability for 1 000 concurrent workers: ~0.000 09 %.
 */

const MAX_COUNTER = (1 << 20) - 1; // 1 048 575
const COUNTER_BITS = 20n;

function createNamespace(): bigint {
  const buf = randomBytes(5); // 40 bits
  let ns = 0n;
  for (const byte of buf) {
    ns = (ns << 8n) | BigInt(byte);
  }
  // Mask to 40 bits and ensure the full 60-bit value stays below 2^63.
  return ns & 0xff_ffff_ffffn;
}

export interface ChainIdAllocator {
  /** Return a fresh unique chain ID and record it for cleanup. */
  next(): bigint;
  /** All IDs produced so far, in allocation order. */
  readonly allocated: readonly bigint[];
}

/**
 * Create a new allocator scoped to one test suite run.
 * Call once at describe scope; reuse across tests in that suite.
 */
export function createChainIdAllocator(): ChainIdAllocator {
  const namespace = createNamespace();
  let counter = 0;
  const allocated: bigint[] = [];

  return {
    next(): bigint {
      if (counter > MAX_COUNTER) {
        throw new RangeError(
          `ChainIdAllocator exhausted: more than ${MAX_COUNTER + 1} IDs requested in one run`,
        );
      }
      const id = (namespace << COUNTER_BITS) | BigInt(counter++);
      allocated.push(id);
      return id;
    },
    get allocated(): readonly bigint[] {
      return allocated;
    },
  };
}
