# API Reference

The live, authoritative reference is generated from the same Zod schemas that validate requests (`fastify-type-provider-zod`) and served at **`/api-docs`** (OpenAPI 3.1 / Swagger UI) whenever the server is running. This document is a human-readable index alongside it — if the two ever disagree, `/api-docs` is correct and this file needs updating.

## Conventions

- All routes are versioned under `/api/v1` except `/health*` and `/api-docs`.
- Success responses: `{ "data": ..., "meta"?: {...} }`.
- Error responses: `{ "error": { "code": "...", "message": "...", "details"?: ... } }` — see `src/shared/errors` for the full code list.
- Mutating endpoints that reflect on-chain state (deliveries, escrow, disputes, fleet) return a **pending transaction record**, not a synchronously-updated resource — the underlying resource only reaches its new state once the blockchain indexer confirms the corresponding on-chain event. See `ARCHITECTURE.md` §9.
- Endpoints that require a wallet-owned signature (`sender`, `recipient`, `driver`, `fleet owner` actions per `PHASE_1_DOMAIN_ANALYSIS.md`) live under `/transactions/build/*` and return unsigned XDR — this backend never signs on a user's behalf (`AUTHENTICATION.md`).

## Implemented Today

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness/readiness: database + Redis connectivity |
| `GET` | `/api-docs` | Interactive OpenAPI/Swagger UI |
| `POST` | `/api/v1/auth/register` | Create a local account (`email`, `password`) — sends a verification email (logged locally in dev, see `AUTHENTICATION.md`) |
| `POST` | `/api/v1/auth/login` | Exchange credentials for an access + refresh token pair |
| `POST` | `/api/v1/auth/refresh` | Rotate a refresh token for a new access + refresh pair; the presented token is revoked |
| `POST` | `/api/v1/auth/logout` | Revoke a refresh token (idempotent — unknown/already-revoked tokens still return success) |
| `POST` | `/api/v1/auth/verify-email` | Consume an email verification token (idempotent) |
| `POST` | `/api/v1/auth/request-password-reset` | Always returns success — no user enumeration; sends a reset email only if the address is registered |
| `POST` | `/api/v1/auth/reset-password` | Consume a password reset token, set a new password, revoke all existing sessions |

All `auth` error responses use the shared envelope: `409 CONFLICT` (duplicate email), `401 UNAUTHORIZED` (bad credentials / invalid or expired token), `400 VALIDATION_ERROR` (malformed request body). See `AUTHENTICATION.md` for the full design (token formats, rotation, password-reset fingerprinting).

| `GET` | `/api/v1/users/me` | The authenticated user's profile plus linked wallet addresses (requires `Authorization: Bearer <access token>`) |
| `GET` | `/api/v1/users/me/wallets` | List the authenticated user's linked wallet addresses |
| `POST` | `/api/v1/users/me/wallets/challenge` | Issue a short-TTL (5m) challenge string for a Stellar address the client wants to link — `{ address }` → `{ challenge }` |
| `POST` | `/api/v1/users/me/wallets/confirm` | Complete linking: `{ address, challenge, signature }`, where `signature` is the ed25519 signature (base64) of `challenge` produced by the wallet's own key. The first wallet a user links becomes their primary. |
| `DELETE` | `/api/v1/users/me/wallets/:id` | Unlink a wallet (must belong to the requesting user — `403 FORBIDDEN` otherwise) |

All `/api/v1/users/*` routes require authentication; unauthenticated requests get `401 UNAUTHORIZED`. See `AUTHENTICATION.md` § Wallet Linking for the full challenge/signature design and why it never touches a private key.

Everything else below is the **planned surface**, matching the module boundaries in `ARCHITECTURE.md` §4 — it will be filled in endpoint-by-endpoint as each module ships in Phase 5, not written speculatively ahead of the code that implements it.

## Planned Endpoint Families

| Module | Example routes |
|---|---|
| `deliveries` | `GET /deliveries`, `GET /deliveries/:id`, `POST /transactions/build/create-delivery`, `POST /transactions/build/assign-driver`, `POST /transactions/build/mark-in-transit`, `POST /transactions/build/confirm-delivery`, `POST /transactions/build/cancel-delivery` |
| `escrow` | `GET /escrow/:deliveryId`, `POST /transactions/build/create-escrow`, `POST /transactions/build/release-escrow`, `POST /transactions/build/refund-escrow` |
| `fleet` | `GET /fleets/:id`, `GET /fleets/:id/payout-address`, `POST /transactions/build/register-fleet`, `POST /transactions/build/add-driver-to-fleet`, `POST /transactions/build/accept-fleet-invite` |
| `disputes` | `GET /disputes/:deliveryId`, `POST /disputes/:deliveryId/evidence`, `POST /transactions/build/raise-dispute` |
| `reputation` | `GET /drivers/:address/reputation` |
| `analytics` | `GET /analytics/gmv`, `GET /analytics/completion-rate`, `GET /analytics/dispute-rate` |
| `admin` | `POST /admin/disputes/:deliveryId/resolve`, `POST /admin/users/:id/role`, `GET /admin/audit-log` |
| — | `POST /transactions/submit` (relay a signed XDR envelope, track confirmation) |

Full request/response schemas for each of these will be documented here as they're implemented — see `ROADMAP.md` §5 (Phase 5 module DoD requires an OpenAPI schema entry and a request/response example for every exposed endpoint before a module is considered done).
