#!/usr/bin/env node
/**
 * Audit: detect tracked test files that belong to no configured test suite.
 *
 * A file is "owned" if it matches at least one include pattern from
 * vitest.config.ts or vitest.e2e.config.ts and is not excluded by
 * the default suite's exclude list.
 *
 * Run: node scripts/audit-test-discovery.mjs
 * Exit 1 if unowned files are found.
 */
import { execSync } from 'node:child_process';

const root = process.cwd();

// Translate vitest glob patterns to simple prefix/suffix checks.
// Include patterns from vitest.config.ts:
//   src/**/*.{spec,test}.ts   -> starts with src/ and ends with .spec.ts or .test.ts
//   tests/**/*.{spec,test}.ts -> starts with tests/ and ends with .spec.ts or .test.ts
// Exclude from vitest.config.ts:
//   **/node_modules/**
//   **/dist/**
//   src/shared/testing/env.bootstrap.test.ts
// E2E include from vitest.e2e.config.ts:
//   tests/e2e/**/*.{spec,test}.ts -> starts with tests/e2e/

function isTestFile(f) {
  return f.endsWith('.spec.ts') || f.endsWith('.test.ts');
}

function isExcluded(f) {
  return (
    f.includes('node_modules/') ||
    f.includes('dist/') ||
    f === 'src/shared/testing/env.bootstrap.test.ts'
  );
}

function isOwnedByDefault(f) {
  if (isExcluded(f)) return false;
  return (f.startsWith('src/') || f.startsWith('tests/')) && isTestFile(f);
}

function isOwnedByE2e(f) {
  return f.startsWith('tests/e2e/') && isTestFile(f);
}

function isOwned(f) {
  return isOwnedByDefault(f) || isOwnedByE2e(f);
}

// Get all tracked spec/test files
const tracked = execSync('git ls-files', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => isTestFile(f) && f.length > 0);

const unowned = tracked.filter((f) => !isOwned(f));

if (unowned.length === 0) {
  console.log('✓ All tracked test files have a suite owner.');
  process.exit(0);
} else {
  console.error('✗ Unowned test files (no configured suite includes these paths):');
  for (const f of unowned) {
    console.error(`  ${f}`);
  }
  process.exit(1);
}
