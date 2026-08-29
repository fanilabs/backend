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
});
