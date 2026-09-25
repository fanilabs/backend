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

/**
 * Creates the login use case, which authenticates a user with email/password
 * credentials and issues a fresh access/refresh token pair on success.
 *
 * @param deps - Collaborators required to authenticate and issue tokens:
 *   - `userRepository`: looks up the user by email.
 *   - `passwordHasher`: verifies the supplied password against the stored hash.
 *   - `tokenService`: issues the access and refresh tokens.
 *   - `refreshTokenRepository`: persists the hashed refresh token for later rotation/revocation.
 * @returns An async `login` function that takes a {@link LoginInput} (email and
 *   password) and resolves to a {@link LoginResult} containing the access token,
 *   refresh token, and the authenticated user's public profile. Throws
 *   {@link InvalidCredentialsError} when the email is unknown or the password
 *   does not match (identical failure for both cases to prevent email enumeration).
 */
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
