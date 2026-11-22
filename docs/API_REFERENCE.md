# API Reference

The live, authoritative reference is generated from the same Zod schemas that validate requests (`fastify-type-provider-zod`) and served at **`/api-docs`** (OpenAPI 3.1 / Swagger UI) whenever the server is running. This document is a human-readable index alongside it — if the two ever disagree, `/api-docs` is correct and this file needs updating.

## Conventions

- All routes are versioned under `/api/v1` except `/health*` and `/api-docs`.
- Success responses: `{ "data": ..., "meta"?: {...} }`.
- Error responses: `{ "error": { "code": "...", "message": "...", "details"?: ... }, "requestId": "<fastify request id>" }` — see `src/shared/errors` for the full code list. The top-level `requestId` lets a user reporting a 500 be correlated to the matching `req.id` in the server's request log line.
- Endpoints that require a wallet-owned signature (`sender`, `recipient`, `driver`, `fleet owner` actions per `PHASE_1_DOMAIN_ANALYSIS.md`) live under `/transactions/build/*` and return unsigned XDR — this backend never signs on a user's behalf (`AUTHENTICATION.md`).
- A successful build response contains **only** the unsigned envelope (`{ "data": { "xdr": "<unsigned envelope>" } }`, matching `transactionResponseSchema` in `src/shared/validation/transaction-response.ts`). It does **not** create a pending transaction record, return a receipt ID, or confirm any chain state — construction success is not on-chain confirmation. The underlying resource only reaches its new state once the client signs, submits, and the blockchain indexer observes the corresponding on-chain event. See `ARCHITECTURE.md` §9.

### Build / sign / submit / observe responsibilities

```
  client                backend (implemented)        chain / indexer
  ------                ----------------------        ---------------
  request build  --->   POST /transactions/build/*
                        validate + simulate/prepare
                 <---   { data: { xdr } }  (unsigned)
  sign locally   --->   (private key never leaves client)
  submit         --->   [outside backend surface]  --->  Stellar network
                                                          |
  observe        <---   GET /deliveries*  <---  indexer confirms event
```

Submission and on-chain observation are **outside the implemented backend surface**: this backend does not submit signed envelopes, does not track a pending transaction resource, and exposes no confirmation-polling endpoint. Clients submit the signed envelope themselves and observe resulting state through the public read models (e.g. `GET /deliveries*`) once the indexer has confirmed the event.

## Analytics measurement contract

The analytics routes expose four read-only metrics. They describe **existing** behavior only; caching and freshness are documented separately (#46). Dashboard authors should read the definitions below rather than inferring units or denominators from raw field names.

### 1. GMV (gross merchandise value)

GMV is the sum of **released, verified escrow amounts**, grouped **per token**. Each token's total is reported in that token's own base units — there is **no exchange-rate conversion** to fiat or to any other token. A GMV figure is therefore only meaningful alongside the token it is denominated in; do not add totals across tokens.

```json
{
  "data": {
    "gmv": [
      { "token": "USDC", "amount": "1250000000" },
      { "token": "XLM", "amount": "42000000" }
    ]
  }
}
```

Empty dataset (no released verified escrow yet):

```json
{ "data": { "gmv": [] } }
```

### 2. Completion rate

Completion rate is `completed / total`, where `total` is the number of deliveries in the dataset and `completed` is the number of those deliveries that reached the completed state. When the denominator is zero (no deliveries), the rate is reported as `0` — not `null` and not an error.

```json
{ "data": { "completed": 8, "total": 10, "rate": 0.8 } }
```

Empty dataset:

```json
{ "data": { "completed": 0, "total": 0, "rate": 0 } }
```

### 3. Dispute rate

Dispute rate is `disputed / total`, where `total` is the number of deliveries in the dataset and `disputed` counts **all deliveries that have ever had a dispute raised** — including disputes that have since been resolved. It is **not** a count of currently open disputes. When the denominator is zero, the rate is reported as `0`.

```json
{ "data": { "disputed": 2, "total": 10, "rate": 0.2 } }
```

A delivery that was disputed and later resolved still counts toward `disputed`:

```json
{ "data": { "disputed": 1, "total": 1, "rate": 1 } }
```

Empty dataset:

```json
{ "data": { "disputed": 0, "total": 0, "rate": 0 } }
```

### 4. Delivery count

The fourth metric is the total number of deliveries in the dataset — the same `total` denominator used by the completion and dispute rates. It is a plain count, not a rate.

```json
{ "data": { "total": 10 } }
```

Empty dataset:

```json
{ "data": { "total": 0 } }
```

## Implemented Today

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness/readiness: database + Redis connectivity |
| `GET` | `/health/indexer` | Per-contract blockchain indexer lag (`now_ledger - lastLedgerSeq`); `200` when all tracked contracts are within `INDEXER_LAG_ALERT_LEDGERS`, `503` otherwise. See `EVENT_INDEXER.md`. |
| `GET` | `/api-docs` | Interactive OpenAPI/Swagger UI |
| `POST` | `/api/v1/auth/register` | Create a local account (`email`, `password`) — sends a verification email (logged locally in dev, see `AUTHENTICATION.md`) |
| `POST` | `/api/v1/auth/login` | Exchange credentials for an access + refresh token pair |
| `POST` | `/api/v1/auth/refresh` | Rotate a refresh token for a new access + refresh pair; the presented token is revoked |
| `POST` | `/api/v1/auth/logout` | Revoke a refresh token (idempotent — unknown/already-revoked tokens still return success) |
| `POST` | `/api/v1/auth/verify-email` | Consume an email verification token (idempotent) |
| `POST` | `/api/v1/auth/request-password-reset` | Always returns success — no user enumeration; sends a reset email only if the address is registered |
| `POST` | `/api/v1/auth/reset-password` | Consume a password reset token, set a new password, revoke all existing sessions |
| `GET` | `/api/v1/notifications` | List the authenticated user's notifications, including nullable `readAt` |
| `GET` | `/api/v1/notifications/:id` | Get one of the authenticated user's notifications |
| `POST` | `/api/v1/notifications/mark-read` | Mark all unread notifications for the authenticated user as read; returns `{ "data": { "count": 5 } }` |

All `/api/v1/notifications*` routes require authentication. The mark-read endpoint scopes updates to the authenticated user and does not change notification delivery status.

All `auth` error responses use the shared envelope: `409 CONFLICT` (duplicate email), `401 UNAUTHORIZED` (bad credentials / invalid or expired token), `400 VALIDATION_ERROR` (malformed request body). See `AUTHENTICATION.md` for the full design (token formats, rotation, password-reset fingerprinting).

| `GET` | `/api/v1/users/me` | The authenticated user's profile plus linked wallet addresses (requires `Authorization: Bearer <access token>`) |
| `GET` | `/api/v1/users/me/wallets` | List the authenticated user's linked wallet addresses |
| `POST` | `/api/v1/users/me/wallets/challenge` | Issue a short-TTL (5m) challenge string for a Stellar address the client wants to link — `{ address }` → `{ challenge }` |
| `POST` | `/api/v1/users/me/wallets/confirm` | Complete linking: `{ address, challenge, signature }`, where `signature` is the ed25519 signature (base64) of `challenge` produced by the wallet's own key. The first wallet a user links becomes their primary. |
| `DELETE` | `/api/v1/users/me/wallets/:id` | Unlink a wallet (must belong to the requesting user — `403 FORBIDDEN` otherwise) |

All `/api/v1/users/*` routes require authentication; unauthenticated requests get `401 UNAUTHORIZED`. See `AUTHENTICATION.md` § Wallet Linking for the full challenge/signature design and why it never touches a private key.

| `GET` | `/api/v1/deliveries` | List deliveries — public read model, optional `senderAddress`/`recipientAddress`/`driverAddress`/`status` query filters |
| `GET` | `/api/v1/deliveries/:chainDeliveryId` | Get one delivery by its on-chain id (`404` if not yet indexed) |
| `POST` | `/api/v1/transactions/build/create-delivery` | Unsigned XDR for `delivery_contract.create_delivery` — `{ senderAddress, recipientAddress, origin, destination, cargoCategory, weightGrams, fragile, estimatedDelivery }`; `origin` must differ from `destination` (case/whitespace-insensitive) and `recipientAddress` from `senderAddress`, or the request fails with `400 VALIDATION_ERROR` |
| `POST` | `/api/v1/transactions/build/assign-driver` | Unsigned XDR for `assign_driver` — caller is admin or the driver self-assigning |
| `POST` | `/api/v1/transactions/build/mark-in-transit` | Unsigned XDR for `mark_in_transit` — the assigned driver only |
| `POST` | `/api/v1/transactions/build/confirm-delivery` | Unsigned XDR for `confirm_delivery` — the recipient only |
| `POST` | `/api/v1/transactions/build/cancel-delivery` | Unsigned XDR for `cancel_delivery` — the sender only |
| `POST` | `/api/v1/transactions/build/raise-delivery-dispute` | Unsigned XDR for `delivery_contract.raise_dispute` — sender or recipient. Distinct from the `disputes` module's own `POST /transactions/build/raise-dispute` (`dispute_resolution_contract.raise_dispute`, the richer Layer B arbitration-case path) — the two previously collided under the identical path, crashing `buildApp()`. |

All `/api/v1/transactions/build/*` routes require authentication (anti-abuse — each call does real RPC work: an account fetch and a full simulate/prepare). All return `{ "data": { "xdr": "<unsigned envelope>" } }`. `GET /deliveries*` is public — it mirrors public on-chain state, like a block explorer. If `DELIVERY_CONTRACT_ID` isn't configured for the running environment (blank by default, see `.env.example`), the build endpoints return `502 BLOCKCHAIN_ERROR` with a clear message rather than a generic failure.

### Delivery list filters

`GET /api/v1/deliveries` accepts four optional query filters, validated by `listDeliveriesQuerySchema` (`src/