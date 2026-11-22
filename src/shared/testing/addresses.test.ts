import { describe, expect, it } from 'vitest';
import { testAddress } from './addresses.js';

describe('testAddress', () => {
  it('produces the same address for a label that already fit within 32 bytes', () => {
    expect(testAddress('driver')).toBe(testAddress('driver'));
  });

  it('accepts a label that is exactly 32 bytes', () => {
    expect(() => testAddress('a'.repeat(32))).not.toThrow();
  });

  it('throws rather than silently truncating a label over 32 UTF-8 bytes', () => {
    expect(() => testAddress('a'.repeat(33))).toThrow(/32-byte/);
  });

  it('throws on a label that is under 32 characters but over 32 UTF-8 bytes', () => {
    // Each '€' is 3 bytes in UTF-8, so 11 of them is 33 bytes despite being
    // only 11 characters — this is exactly what a character-length check
    // would miss.
    const label = '€'.repeat(11);
    expect(() => testAddress(label)).toThrow(/32-byte/);
  });

  it('does not let two labels that share the first 32 bytes collide on the same address', () => {
    const a = 'b'.repeat(32);
    const b = `${'b'.repeat(32)}-suffix`;
    expect(() => testAddress(b)).toThrow();
    expect(testAddress(a)).toBeTypeOf('string');
  });
});
