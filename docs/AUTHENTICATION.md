# Authentication

## Two Distinct Identity Concepts

Per `PHASE_1_DOMAIN_ANALYSIS.md` §1, the smart contracts have **no concept of email, password, or session** — on-chain identity is a Stellar `Address` authenticated by that address's own signature (`require_auth()`). This backend owns a *separate*, off-chain identity layer (local accounts) and links it to one or more wallet addresses. The two are related but not the same thing:

| | Off-chain account (`users` table) | On-chain identity (`Address`) |
|---|---|---|
| Created by | `POST /api/v1/auth/register` | A Stellar keypair (client-side, e.g. Freighter) |
| Authenticates via | Email + password → JWT | Transaction signature |
| Used for | Login, RBAC, notifications, KYC intake | Every contract call's `require_auth()` |

## Local Account Auth

- **Registration** (`POST /api/v1/auth/register`): email + password (bcrypt, 12 salt rounds, never stored or logged in plaintext — see the logger's redaction config in `src/shared/logger/index.ts`), `role` defaults to `CUSTOMER`. Rejects a duplicate email (case-insensitively normalized) with `409 CONFLICT`.
- **Email verification** (`POST /api/v1/auth/verify-email`): a JWT signed with `JWT_ACCESS_SECRET`, `purpose: 'email-verification'`, 24h TTL. Verifying twice is a harmless no-op (idempotent), not an error.
- **Login** (`POST /api/v1/auth/login`): issues a short-lived **access token** (JWT, `JWT_ACCESS_TTL`, default 15m, claims `{ sub, role }`) and a longer-lived **refresh token** (a signed JWT, `JWT_REFRESH_TTL`, default 30d, claims `{ sub, jti }`, but only its SHA-256 hash is ever persisted — `refresh_tokens.token_hash` — the raw token itself lives only in the response and the client's storage). Access tokens are never persisted server-side (stateless, verified by signature); refresh tokens are revocable (`revoked_at`) independent of their own JWT expiry, so a compromised refresh token can be invalidated without waiting for it to expire.
  - **Rotation-on-use**: `POST /api/v1/auth/refresh` revokes the presented refresh token and issues a fresh pair — reusing an already-rotated (or logged-out) refresh token fails with `401 UNAUTHORIZED`.
- **Logout** (`POST /api/v1/auth/logout`): revokes the presented refresh token by hash lookup. Best-effort/idempotent — an unknown or already-revoked token still returns success.
- **Password reset**: `POST /api/v1/auth/request-password-reset` always returns success regardless of whether the email is registered (no user enumeration) and only actually sends an email for a known address. `POST /api/v1/auth/reset-password` consumes a JWT (`purpose: 'password-reset'`, 1h TTL) that embeds a short fingerprint (`sha256(passwordHash).slice(0,16)`, not the raw hash) of the password hash that was current when it was issued — verifying against the *current* hash means the token self-invalidates the instant the password actually changes, with no separate revocation table needed. A successful reset also revokes every existing refresh token for that user.
- **RBAC**: `UserRole` enum — `CUSTOMER`, `COURIER`, `FLEET_MANAGER`, `ADMIN`. Enforced via `authenticate` + `requireRole(...)` Fastify `preHandler`s (`src/shared/http/plugins/auth-guard.ts`), attached per-route — route-level, not scattered `if` checks inside handlers, and public routes (register/login) simply don't attach the guard rather than needing an allow-list exception.
- **Dev email delivery**: the default `Mailer` implementation (`createLoggerMailer`, `src/modules/auth/infrastructure/logger-mailer.ts`) logs verification/reset tokens via the structured logger instead of sending real email — genuinely functional for local development (read the token straight from logs) and CI, with a real provider (SES/SendGrid/Postmark/...) swappable behind the same `Mailer` port whenever one is needed.

## Wallet Linking

A user links a Stellar address via a **challenge-response** flow (standard practice, not yet implemented — planned for the `users` module): the backend issues a random nonce, the client signs it with the wallet's key (off-chain signature, no transaction/fee involved), and the backend verifies the signature against the claimed address before marking `wallet_addresses.verifiedAt`. This proves address ownership without ever handling a private key.

## Transaction Signing — Never Backend-Custodied

Per `ARCHITECTURE.md` §2 and the lesson in `PHASE_2_REFERENCE_ANALYSIS.md` §5.7: **the backend never holds a sender/recipient/driver/fleet-owner private key.** Every contract call requiring that party's own `require_auth()` is exposed as a `POST /transactions/build/...` endpoint returning an unsigned XDR envelope for the client's wallet to sign. The only party whose signature the backend could ever legitimately hold is a backend-managed *admin* hot-wallet, and no such capability is assumed or implemented in this scaffold — if a future admin-automation feature needs it, that's a distinct, explicitly-scoped decision documented here and in `SECURITY.md` when it happens, not a default.

## JWT Details

- Algorithm: HS256 with `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (each ≥ 32 chars, validated at boot by `src/shared/config/env.ts` — the process refuses to start with a weak or missing secret). Single source of truth for signing/verifying session tokens: `src/shared/jwt` — used both by the `auth` module (issuing) and the shared HTTP guard (verifying), so claim shape and secret handling can't drift between the two.
- Access token claims: `sub` (user id), `role`, `iat`, `exp`. No PII beyond the user id.
- Email-verification/password-reset tokens are signed with `JWT_ACCESS_SECRET` too but carry an explicit `purpose` claim, checked strictly on verify — this prevents a token issued for one purpose (or a real access token) from being replayed as another, since they're otherwise sharing a signing secret. See `src/modules/auth/infrastructure/jwt-token-service.ts`.
- Refresh rotation: presenting a valid refresh token issues a new access + refresh token pair and revokes the old refresh token, limiting the blast radius of a leaked refresh token.

## Architecture

The `auth` module follows the layering in `ARCHITECTURE.md` §1 exactly: `domain/ports.ts` defines `UserRepository`, `RefreshTokenRepository`, `PasswordHasher`, `TokenService`, `Mailer`, and `Clock` as interfaces; `application/` has one file per use case (`register-user.ts`, `login.ts`, `refresh-session.ts`, `logout.ts`, `verify-email.ts`, `request-password-reset.ts`, `reset-password.ts`), each a small factory function taking only the ports it needs; `infrastructure/` provides the real Prisma/bcrypt/jsonwebtoken-backed implementations; `interface/routes.ts` is a thin Fastify plugin mapping HTTP to use cases. `index.ts` is the module's composition root — the one place that wires infrastructure into application and hands `app.ts` a ready-to-register plugin.

## Status

Implemented (Phase 5, first module). 42 unit/infrastructure tests pass without any external dependency; a further set of Prisma-backed repository tests and full HTTP-level integration tests exist and run in CI (real Postgres service container) but are automatically skipped, not failed, in any environment without a reachable database (see `src/shared/testing/database.ts`).
