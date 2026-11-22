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
 * Optionally select specific targets by name (default: all):
 *   LOAD_TEST_TARGETS=health,metrics pnpm load-test
 *
 * Configuration:
 *   BASE_URL                       API base URL (default: http://localhost:3000)
 *   LOAD_TEST_DURATION_SECONDS     Seconds per endpoint (default: 10)
 *   LOAD_TEST_CONNECTIONS         Concurrent connections (default: 20)
 *   LOAD_TEST_TARGETS              Comma-separated target names to benchmark (default: all)
 *
 * Prints autocannon's own summary (requests/sec, latency percentiles,
 * error count) per endpoint — see docs/OBSERVABILITY.md for the results
 * from the run this script was verified against.
 */
import autocannon from 'autocannon';

const baseUrl = normalizeBaseUrl(process.env.BASE_URL ?? 'http://localhost:3000');
const duration = parseDuration(process.env.LOAD_TEST_DURATION_SECONDS ?? '10');
const connections = parseConnections(process.env.LOAD_TEST_CONNECTIONS ?? '20');

const allTargets = [
  { name: 'health', path: '/health' },
  { name: 'deliveries list', path: '/api/v1/deliveries' },
  { name: 'delivery 404', path: '/api/v1/deliveries/999999999999999' },
  { name: 'metrics', path: '/metrics' },
];

function normalizeBaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Invalid protocol: ${parsed.protocol}. Must be http:// or https://`);
    }
    return url.replace(/\/$/, '');
  } catch (error) {
    throw new Error(`Invalid BASE_URL: ${url}. Must be a valid HTTP(S) URL`);
  }
}

function parseDuration(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`LOAD_TEST_DURATION_SECONDS must be a positive integer, got: ${input}`);
  }
  return value;
}

function parseConnections(input: string): number {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`LOAD_TEST_CONNECTIONS must be a positive integer, got: ${input}`);
  }
  return value;
}

function selectTargets(): typeof allTargets {
  const targetNames = process.env.LOAD_TEST_TARGETS?.trim();
  if (!targetNames) {
    return allTargets;
  }

  const names = targetNames.split(',').map((s) => s.trim());
  const selected = names.map((name) => {
    const target = allTargets.find((t) => t.name === name);
    if (!target) {
      const available = allTargets.map((t) => t.name).join(', ');
      throw new Error(`Unknown target: ${name}. Available: ${available}`);
    }
    return target;
  });

  if (selected.length === 0) {
    throw new Error('LOAD_TEST_TARGETS is empty');
  }

  return selected;
}

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
  const targets = selectTargets();
  console.log(`Load testing ${baseUrl} — ${connections} connections, ${duration}s per endpoint`);
  for (const target of targets) {
    await runOne(target.name, target.path);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
