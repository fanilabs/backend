import type {
  Mailer,
  PasswordHasher,
  TokenService,
  UserRepository,
  UserRole,
} from '../domain/index.js';
import { EmailAlreadyRegisteredError } from '../domain/index.js';

export interface RegisterUserDeps {
  userRepository: UserRepository;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  mailer: Mailer;
}

export interface RegisterUserInput {
  email: string;
  password: string;
  role?: UserRole;
}

export interface RegisterUserResult {
  userId: string;
}

/**
 * Creates the register-user use case for the auth module.
 *
 * The returned use case registers a new user by normalizing the email,
 * rejecting duplicates, hashing the password, persisting the user, and
 * sending an email verification token. It throws
 * {@link EmailAlreadyRegisteredError} when the email is already in use.
 *
 * @param deps - Dependencies required by the use case:
 *   - `userRepository`: looks up users by email and creates new user records.
 *   - `passwordHasher`: hashes the raw password before persistence.
 *   - `tokenService`: issues the email verification token for the new user.
 *   - `mailer`: sends the verification email to the registered address.
 * @returns An async function that accepts a {@link RegisterUserInput}
 *   (`email`, `password`, and optional `role`, defaulting to `'CUSTOMER'`)
 *   and resolves to a {@link RegisterUserResult} containing the new `userId`.
 */
export function createRegisterUserUseCase(deps: RegisterUserDeps) {
  return async function registerUser(input: RegisterUserInput): Promise<RegisterUserResult> {
    const email = normalizeEmail(input.email);

    const existing = await deps.userRepository.findByEmail(email);
    if (existing) {
      throw new EmailAlreadyRegisteredError(email);
    }

    const passwordHash = await deps.passwordHasher.hash(input.password);
    const user = await deps.userRepository.create({
      email,
      passwordHash,
      role: input.role ?? 'CUSTOMER',
    });

    const verificationToken = deps.tokenService.issueEmailVerificationToken(user);
    await deps.mailer.sendVerificationEmail(user.email, verificationToken);

    return { userId: user.id };
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
