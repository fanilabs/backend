#!/usr/bin/env node
// Offline checker for repository-relative Markdown links and anchors.
//
// Validates that local file links resolve to real files and that `#fragment`
// anchors resolve to real headings. HTTP(S) links are never fetched.
//
// Usage: node scripts/check-doc-links.mjs [files...]
// With no arguments, scans the maintained documentation set below.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Maintained docs scanned by default. Historical records and local
// unpublished backlogs are intentionally excluded rather than suppressing
// all Markdown.
const DEFAULT_DOCS = ['README.md', 'CONTRIBUTING.md', 'docs/DATABASE.md'];

// Explicit historical exclusions: these files are records of past state and
// are not expected to keep working local links.
const HISTORICAL_EXCLUSIONS = new Set([
  'CHANGELOG.md',
  'docs/archive',
]);

function isExcluded(relPath) {
  for (const ex of HISTORICAL_EXCLUSIONS) {
    if (relPath === ex || relPath.startsWith(ex + '/')) return true;
  }
  return false;
}

// GitHub-style heading slug: lowercase, strip punctuation, spaces -> dashes.
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function collectAnchors(markdown) {
  const anchors = new Set();
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) anchors.add(slugify(m[1]));
  }
  return anchors;
}

// Extract inline markdown links: [text](target)
function extractLinks(markdown) {
  const links = [];
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  lines.forEach((line, idx) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      links.push({ target: m[1], line: idx + 1 });
    }
  });
  return links;
}

function isExternal(target) {
  return /^(https?:)?\/\//i.test(target) || /^mailto:/i.test(target);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function checkFile(relPath, errors) {
  const absPath = resolve(repoRoot, relPath);
  if (!existsSync(absPath)) {
    errors.push(`${relPath}: file not found`);
    return;
  }
  const markdown = readFileSync(absPath, 'utf8');
  const links = extractLinks(markdown);

  for (const { target, line } of links) {
    if (isExternal(target)) continue; // never fetch HTTP links
    if (target.startsWith('#')) {
      const anchor = safeDecode(target.slice(1));
      const anchors = collectAnchors(markdown);
      if (anchor && !anchors.has(anchor)) {
        errors.push(`${relPath}:${line}: missing heading #${anchor}`);
      }
      continue;
    }

    const [rawPath, rawFragment] = target.split('#');
    const decodedPath = safeDecode(rawPath);
    const targetAbs = resolve(dirname(absPath), decodedPath);

    if (!existsSync(targetAbs)) {
      errors.push(`${relPath}:${line}: missing local file ${decodedPath}`);
      continue;
    }

    if (rawFragment) {
      const stat = statSync(targetAbs);
      if (stat.isFile() && extname(targetAbs).toLowerCase() === '.md') {
        const anchor = safeDecode(rawFragment);
        const anchors = collectAnchors(readFileSync(targetAbs, 'utf8'));
        if (anchor && !anchors.has(anchor)) {
          errors.push(
            `${relPath}:${line}: missing heading #${anchor} in ${decodedPath}`,
          );
        }
      }
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const files = (args.length > 0 ? args : DEFAULT_DOCS).filter(
    (f) => !isExcluded(relative(repoRoot, resolve(repoRoot, f))),
  );

  const errors = [];
  for (const file of files) {
    checkFile(file, errors);
  }

  if (errors.length > 0) {
    console.error('Documentation link check failed:');
    for (const err of errors) console.error(`  ${err}`);
    process.exit(1);
  }

  console.log(`Documentation link check passed (${files.length} file(s)).`);
}

main();
