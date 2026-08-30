import { describe, expect, it } from 'vitest';

import { registerBodySchema, resetPasswordBodySchema } from './schemas.js';

describe('auth password schema (byte-accurate max length)', () => {
  it('accepts a 72-byte pure-ASCII password', () => {
    const password = 'a'.repeat(72);
    expect(Buffer.byteLength(password, 'utf8')).toBe(72);

    const result = registerBodySchema.safeParse({ email: 'user@example.com', password });
    expect(result.success).toBe(true);
  });

  it('rejects a password under 72 JS characters but over 72 UTF-8 bytes', () => {
    // 20 emoji: 40 UTF-16 code units (well under a naive .max(72)) but
    // 80 UTF-8 bytes — bcrypt would silently truncate this.
    const password = '😀'.repeat(20);
    expect(password.length).toBeLessThan(72);
    expect(Buffer.byteLength(password, 'utf8')).toBeGreaterThan(72);

    const result = registerBodySchema.safeParse({ email: 'user@example.com', password });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i) => i.message)).toContain(
      'Password must be at most 72 bytes long',
    );
  });

  it('applies the same byte-accurate bound to resetPasswordBodySchema.newPassword', () => {
    const result = resetPasswordBodySchema.safeParse({
      token: 'reset-token',
      newPassword: '😀'.repeat(20),
    });
    expect(result.success).toBe(false);
  });

  it('still rejects passwords shorter than 8 characters', () => {
    const result = registerBodySchema.safeParse({ email: 'user@example.com', password: 'short' });
    expect(result.success).toBe(false);
  });
});
