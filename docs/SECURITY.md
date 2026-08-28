# Security

## Reporting a Vulnerability

Please do not open a public GitHub issue for security vulnerabilities. Instead, email the maintainers (see the FaniLab organization contact in the smart contract repository's `SECURITY.md`) with a description, reproduction steps, and impact assessment. We aim to acknowledge reports within 5 business days.

## Custody Model

**This backend never holds private keys for senders, recipients, drivers, or fleet owners.** Every contract call requiring one of those parties' `require_auth()` is built as an unsigned XDR transaction and returned to the client for wallet signing (see [`AUTHENTICATION.md`](./AUTHENTICATION.md)). This eliminates an entire class of risk (a compromised backend cannot move user funds) by construction, not by policy — there is no code path that constructs a signature for a user-owned action.

## Baseline HTTP Security

- **Helmet** (`@fastify/helmet`) with a strict default CSP (`default-src 'self'`, `object-src 'none'`); relaxed only for the Swagger UI route, never globally.
- **CORS**: explicit allow-listed origins (`CORS_ORIGIN`), credentials only for those origins — never a wildcard with credentials enabled.
- **Rate limiting**: Redis-backed (`@fastify/rate-limit`), so limits hold across horizontally scaled API instances rather than resetting per-process.
- **Input validation**: every route's request body/params/query validated by a Zod schema (`fastify-type-provider-zod`) before handler code runs — rejected requests never reach application logic.
- **SQL injection**: Prisma's parameterized queries throughout; no raw string-interpolated SQL. The one `$queryRaw` usage (`src/shared/http/routes/health.ts`) is a static, parameter-free `SELECT 1`.

## Secrets

- All secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `CONTRACT_DEPLOYER_KEY`-equivalents if ever needed) are read from environment variables, validated at boot (`src/shared/config/env.ts`) — the process refuses to start with a missing or too-short secret rather than falling back to an insecure default.
- `.env` is git-ignored; `.env.example` documents every variable without real values.
- Logs redact `authorization`/`cookie` headers and any field named `password`, `passwordHash`, `token`, `accessToken`, `refreshToken` (`src/shared/logger/index.ts`) — this is enforced at the logger level, not left to call-site discipline.

## Authentication & Authorization

- Local accounts: bcrypt-hashed passwords, JWT access/refresh tokens with rotation-on-use, RBAC (`CUSTOMER` / `COURIER` / `FLEET_MANAGER` / `ADMIN`). Full detail: [`AUTHENTICATION.md`](./AUTHENTICATION.md).
- On-chain authorization is enforced by the contracts themselves (`require_auth()`) — this backend does not and cannot bypass that; it only ever proposes transactions for the rightful signer to authorize.

## Audit Logging

Privileged/sensitive actions (admin dispute resolutions, KYC status changes, role changes) are recorded in the `audit_logs` table with actor, action, entity, and timestamp — a structural requirement of the `admin` module design (`ARCHITECTURE.md` §4), not an afterthought bolted on later.

## Security Review History

**Phase 6 (first dedicated pass)**: a full-codebase review covering auth/authorization, IDOR, path traversal, injection, cryptographic token handling, mass assignment, SSRF, and sensitive-data exposure. One real, fixed finding: `disputes` evidence upload/download had no ownership check at all — any authenticated user could upload arbitrary content to any open dispute under any address's name, and download any dispute's evidence file given only its id (itself discoverable via the public dispute-read endpoint). Fixed by requiring the caller to own the wallet they're uploading as, and restricting download to `ADMIN`/the uploader/the dispute's raiser — see `API_REFERENCE.md`'s disputes section and `src/modules/disputes/application/{upload,download}-evidence.ts`. Everything else reviewed (JWT handling, wallet-link challenge binding, password-reset token design, evidence-storage path-traversal guard, CORS/Helmet config, error-message/log redaction) held up without changes needed.

## Known On-Chain Considerations Relevant to Backend Security

From `PHASE_1_DOMAIN_ANALYSIS.md` §3: `escrow_contract.freeze_funds` has no `require_auth` check at all on-chain — callable by anyone. The backend does not rely on this function being access-controlled and does not expose an unauthenticated route that triggers it; only the `dispute_resolution_contract`'s own authorized flow calls it, on-chain, outside this backend's control.

## Dependency Management

Dependabot (`.github/dependabot.yml`) tracks npm, Docker base images, and GitHub Actions weekly; major version bumps require manual review rather than auto-merge.

Dependabot only proposes upgrades — it does not fail a build for a known-vulnerable dependency that hasn't been upgraded yet. To close that gap, the `audit` job in `.github/workflows/ci.yml` runs `pnpm audit --audit-level=high` on every PR and on `main`; a `high` or `critical` advisory anywhere in the dependency tree (direct or transitive) fails CI. Run it locally with `pnpm audit`.

**Accepted exceptions:** none currently. If an advisory has no available fix and must be temporarily tolerated, it must be listed here with the advisory id, the affected package, a rationale, and an owner — the audit threshold is never lowered globally to work around a single unfixable advisory.

## Reporting Timeline & Disclosure

Coordinated disclosure: we ask reporters to give us a reasonable window to ship a fix before public disclosure. Credited in release notes unless anonymity is requested.
