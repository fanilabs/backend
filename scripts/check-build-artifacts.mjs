#!/usr/bin/env node
// Post-build artifact contract check for the production compilation output.
// Verifies entrypoints exist, no test/spec/fixture output leaked into dist,
// and every relative ESM import in emitted JavaScript resolves to a real file.
// Does not start either process.
import { readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');

const REQUIRED_ENTRYPOINTS = ['server.js', path.join('workers', 'index.js')];

// Mirrors the exclusions in tsconfig.build.json: specs, tests and fixtures
// must never be emitted into the production artifact.
const FORBIDDEN_PATTERNS = [/\.spec\.js$/, /\.test\.js$/, /(^|[\\/])__fixtures__([\\/]|$)/];

const RELATIVE_IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

const failures = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isForbidden(relPath) {
  return FORBIDDEN_PATTERNS.some((re) => re.test(relPath));
}

async function resolvesToJsFile(specifier, fromFile) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    if (candidate.endsWith('.js') && existsSync(candidate)) {
      const info = await stat(candidate);
      if (info.isFile()) return true;
    }
  }
  return false;
}

async function main() {
  if (!existsSync(distDir)) {
    console.error(`[artifact-check] dist directory not found at ${distDir}. Run the build first.`);
    process.exit(1);
  }

  for (const entry of REQUIRED_ENTRYPOINTS) {
    const full = path.join(distDir, entry);
    if (!existsSync(full)) {
      failures.push(`Missing production entrypoint: dist/${entry}`);
    }
  }

  const files = await walk(distDir);

  for (const file of files) {
    const rel = path.relative(distDir, file);
    if (isForbidden(rel)) {
      failures.push(`Forbidden test artifact emitted: dist/${rel}`);
    }
  }

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(file, 'utf8');
    const rel = path.relative(distDir, file);
    let match;
    RELATIVE_IMPORT_RE.lastIndex = 0;
    while ((match = RELATIVE_IMPORT_RE.exec(source)) !== null) {
      const specifier = match[1] ?? match[2];
      if (!specifier) continue;
      const ok = await resolvesToJsFile(specifier, file);
      if (!ok) {
        failures.push(`Unresolved relative import '${specifier}' in dist/${rel}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error('[artifact-check] Production artifact contract violated:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('[artifact-check] Production artifact contract satisfied.');
}

main().catch((error) => {
  console.error('[artifact-check] Unexpected failure:', error);
  process.exit(1);
});
