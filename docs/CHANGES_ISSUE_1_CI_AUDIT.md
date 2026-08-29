# Issue 1 — CI dependency vulnerability audit

## Problem

CI ran format/lint/typecheck/build/test but never audited the dependency
tree for known vulnerabilities. Dependabot only proposes upgrades on a
weekly cadence — it does not fail a PR when a known-vulnerable dependency
(direct or transitive) is present and no upgrade has landed yet.

## What was implemented

- **`.github/workflows/ci.yml`**: added a new `audit` job that runs
  `pnpm audit --audit-level=high` on every push to `main` and every pull
  request (the workflow's existing `on:` triggers already cover both). It
  runs independently of `lint-and-typecheck`/`build`/`test` so a failing
  audit is visible as its own check.
- **`package.json`**: added an `audit` script (`pnpm audit --audit-level=high`)
  so contributors can run the same check locally before pushing.
- **`docs/SECURITY.md`**: documented the new check under
  "Dependency Management", including the policy that any accepted
  exception (an advisory with no available fix) must be recorded there
  with the advisory id, affected package, rationale, and an owner —
  never by lowering the audit threshold globally.
- **`CONTRIBUTING.md`**: added `pnpm audit` to the pre-push local check
  list and a pointer to the exceptions process.

## Acceptance criteria status

- [x] A dependency with a high-severity advisory fails CI (the new
      `audit` job exits non-zero on any `high`/`critical` finding).
- [x] The job runs on every PR and on `main` (workflow-level trigger,
      unchanged).
- [x] Any accepted exceptions are listed with a reason (see
      `docs/SECURITY.md` § Dependency Management — currently none).
- [x] `docs/SECURITY.md` describes the check.

## Not done in this change

Per the task instructions, this change was made without running
`pnpm install` / `pnpm audit` against the current lockfile, so the actual
current-baseline severity level has not been verified against a live
run. Before merging, run `pnpm audit --audit-level=high` locally (or let
the new CI job run once) to confirm the current tree passes at that
threshold, and adjust the level or add documented exceptions if it
doesn't.
