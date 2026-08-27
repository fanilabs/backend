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
