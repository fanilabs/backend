#!/usr/bin/env -S node --import tsx
/**
 * A basic load-test pass against a running instance of this API (Phase 6,
 * ROADMAP.md M8). Targets public, read-only, no-side-effect endpoints
 * only — this never touches auth/mutating routes, since it's meant to be
 * safely runnable against any environment without creating data or
 * needing credentials.
 *
 * Usage:
 *   pnpm dev                                  # in one terminal
 *   BASE_URL=http://localhost:3000 pnpm load-test   # in another
 *
 * Prints autocannon's own summary (requests/sec, latency percentiles,
 * error count) per endpoint — see docs/OBSERVABILITY.md for the results
 * from the run this script was verified against.
 */
import autocannon from 'autocannon';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const duration = Number(process.env.LOAD_TEST_DURATION_SECONDS ?? 10);
const connections = Number(process.env.LOAD_TEST_CONNECTIONS ?? 20);

const targets = [
  { name: 'health', path: '/health' },
  { name: 'deliveries list', path: '/api/v1/deliveries' },
  { name: 'delivery 404', path: '/api/v1/deliveries/999999999999999' },
  { name: 'metrics', path: '/metrics' },
];

async function runOne(name: string, path: string): Promise<void> {
  const result = await autocannon({
    url: `${baseUrl}${path}`,
    duration,
    connections,
  });

  console.log(`\n=== ${name} (${path}) ===`);
  console.log(
    `requests/sec: ${result.requests.average.toFixed(1)}  ` +
      `latency p50/p95/p99 (ms): ${result.latency.p50}/${result.latency.p97_5}/${result.latency.p99}  ` +
      `2xx: ${result['2xx']}  errors: ${result.errors}  timeouts: ${result.timeouts}  non2xx: ${result.non2xx}`,
  );
}

async function main(): Promise<void> {
  console.log(`Load testing ${baseUrl} — ${connections} connections, ${duration}s per endpoint`);
  for (const target of targets) {
    await runOne(target.name, target.path);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
