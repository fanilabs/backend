import { describe, expect, it } from 'vitest';
import { createBcryptPasswordHasher } from './bcrypt-password-hasher.js';

describe('createBcryptPasswordHasher', () => {
  it('produces a bcrypt-formatted hash distinct from the plaintext', async () => {
    const hasher = createBcryptPasswordHasher();

    const hash = await hasher.hash('correct horse battery staple');

    expect(hash).not.toBe('correct horse battery staple');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  }, 15_000);

  it('confirms a matching password', async () => {
    const hasher = createBcryptPasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.compare('correct horse battery staple', hash)).resolves.toBe(true);
  }, 15_000);

  it('rejects a non-matching password', async () => {
    const hasher = createBcryptPasswordHasher();
    const hash = await hasher.hash('correct horse battery staple');

    await expect(hasher.compare('wrong password', hash)).resolves.toBe(false);
  }, 15_000);
});
