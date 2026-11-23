import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../src/app.js';

const OUTPUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'build',
  'openapi.json',
);

/**
 * Recursively sort object keys so the exported document has deterministic
 * ordering suitable for review and diffing. Arrays keep their original order.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    // Ensure route registrations are materialized without listening on a port.
    await app.ready();
    const document = app.swagger();
    const serialized = `${JSON.stringify(sortKeys(document), null, 2)}\n`;
    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, serialized, 'utf8');
    process.stdout.write(`OpenAPI document written to ${OUTPUT_PATH}\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Failed to export OpenAPI document: ${message}\n`);
  process.exitCode = 1;
});
