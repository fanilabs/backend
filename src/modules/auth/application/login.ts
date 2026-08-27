import type {
  PasswordHasher,
  RefreshTokenRepository,
  TokenService,
  UserRepository,
} from '../domain/index.js';
import { InvalidCredentialsError } from '../domain/index.js';

export interface LoginDeps {
  userRepository: UserRepository;
  passwordHasher: PasswordHasher;
  tokenService: TokenService;
  refreshTokenRepository: RefreshTokenRepository;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string; emailVerifiedAt: Date | null };
}

export function createLoginUseCase(deps: LoginDeps) {
  return async function login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const user = await deps.userRepository.findByEmail(email);

    // Deliberately identical failure for "no such user" and "wrong password"
    // — distinguishing them lets an attacker enumerate registered emails.
    if (!user) {
      throw new InvalidCredentialsError();
    }
    const passwordMatches = await deps.passwordHasher.compare(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    const accessToken = deps.tokenService.issueAccessToken(user);
    const issued = deps.tokenService.issueRefreshToken(user);
    await deps.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
    });

    return {
      accessToken,
      refreshToken: issued.token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerifiedAt: user.emailVerifiedAt,
      },
    };
  };
}
