import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { disconnectPrisma } from '../../src/shared/database/index.js';
import { isDatabaseAvailable } from '../../src/shared/testing/database.js';

// E2E exercises the *composed* application against the real Postgres + Redis
// stack (the CI e2e job provides both via service containers). Gated on
// database reachability with the same skip-not-fail pattern every other
// integration suite uses — a sandbox with no dev stack gets an honest
// "skipped", never a false pass or failure (see ROADMAP.md §10 and
// src/shared/testing/database.ts).
const dbAvailable = await isDatabaseAvailable();

/**
 * Smoke-level end-to-end coverage: boots the exact `buildApp()` composition
 * behind `src/server.ts` (every module, every Fastify plugin) as a real HTTP
 * server and interrogates it over the wire against live Postgres + Redis.
 *
 * The full business flow ROADMAP.md §10 names (register → link wallet →
 * create delivery → fund escrow → confirm → verify reputation updated) needs
 * a local Soroban test ledger or a recorded/mocked RPC fixture, since no
 * FaniLab contracts are deployed anywhere this repo controls. That is the
 * documented next step — see `tests/e2e/README.md`. This spec pins the
 * harness's wiring so the scheduled/release job already runs a meaningful,
 * non-flaky end-to-end assertion today.
 */
describe.skipIf(!dbAvailable)('composed application (end-to-end)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<unknown>;

  beforeAll(async () => {
    const app = await buildApp();
    closeServer = () => app.close();
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    baseUrl = address;
  });

  afterAll(async () => {
    await closeServer?.();
    await disconnectPrisma();
  });

  it('serves a 200 readiness response from the live Postgres + Redis stack', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; database: string; redis: string };
    expect(body).toEqual({ status: 'ok', database: 'ok', redis: 'ok' });
  });

  it('mounts the API modules under /api/v1 (proving the full composition registered)', async () => {
    // An unauthenticated request to a route from a real module's interface
    // returns 401 (auth rejects first), not 404 — which proves the composed
    // module is actually registered on the live server.
    const res = await fetch(`${baseUrl}/api/v1/users/me`, {
      headers: { authorization: 'Bearer definitely-not-a-real-token' },
    });
    expect(res.status).toBe(401);
  });

  it('reports the queue health endpoint over HTTP', async () => {
    const res = await fetch(`${baseUrl}/health/queue`);
    // `ok` when no monitored queue has a permanently-failed job — fine on a
    // freshly-provisioned CI stack. Existence + shape are what matter here.
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as { status: string; queues: unknown[] };
    expect(['ok', 'degraded']).toContain(body.status);
    expect(Array.isArray(body.queues)).toBe(true);
  });

  /**
   * Regression for a boot-blocking bug this `beforeAll` itself would have
   * failed on: `deliveries` and `disputes` both used to register
   * `POST /transactions/build/raise-dispute`, which made `buildApp()` throw
   * `FST_ERR_DUPLICATED_ROUTE` (Fastify refuses two handlers for the same
   * method+path) the instant both modules were composed together — i.e.
   * always, in the real app. `deliveries`' registration was renamed to
   * `raise-delivery-dispute` (see that route's own comment for why the two
   * are legitimately different on-chain actions, not a true duplicate).
   * Both endpoints must be independently reachable at distinct paths, and
   * neither may 404 (a 404 here would mean the route silently vanished
   * instead of being renamed) — 401 (unauthenticated) proves each is
   * registered and wired to the auth guard.
   */
  it('registers both raise-dispute build endpoints at distinct paths, not colliding', async () => {
    // A well-formed body (matching each route's own schema) so the request
    // reaches the `authenticate` preHandler rather than being short-circuited
    // by Fastify's earlier preValidation body-schema check — a 400 here
    // wouldn't distinguish "route doesn't exist"/"routes collided" from
    // "body was malformed", the actual thing this test needs to prove.
    const payload = JSON.stringify({
      callerAddress: Keypair.random().publicKey(),
      chainDeliveryId: '1',
    });

    const disputesRes = await fetch(`${baseUrl}/api/v1/transactions/build/raise-dispute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: payload,
    });
    const deliveriesRes = await fetch(
      `${baseUrl}/api/v1/transactions/build/raise-delivery-dispute`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload },
    );

    expect(disputesRes.status).toBe(401);
    expect(deliveriesRes.status).toBe(401);
  });
});
