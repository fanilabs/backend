import bcrypt from 'bcrypt';
import type { PasswordHasher } from '../domain/index.js';

const SALT_ROUNDS = 12;

export function createBcryptPasswordHasher(): PasswordHasher {
  return {
    async hash(plain) {
      return bcrypt.hash(plain, SALT_ROUNDS);
    },
    async compare(plain, hash) {
      return bcrypt.compare(plain, hash);
    },
  };
}
