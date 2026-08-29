# Contributing to fanilab-backend

Thanks for considering a contribution. This project aims to be a credible, maintained open-source backend — the bar for merged code is production quality, not "works on my machine."

## Before You Start

- Read [`ROADMAP.md`](./ROADMAP.md) to see what phase the project is in and what's actually in scope right now.
- Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) so your change fits the module/layer boundaries instead of fighting them.
- If your change touches blockchain integration, read [`PHASE_1_DOMAIN_ANALYSIS.md`](./PHASE_1_DOMAIN_ANALYSIS.md) first — this backend never invents on-chain functionality the deployed contracts don't actually support.
- For anything non-trivial, open an issue before a PR. Large unsolicited architectural changes are unlikely to be merged as-is.

## Development Setup

See [`README.md` → Getting Started](./README.md#getting-started).

## Workflow

1. Fork or branch (`feat/…`, `fix/…`, `docs/…`).
2. Make your change inside the correct module/layer — see `ARCHITECTURE.md` §1 and §5. Domain code has zero framework imports; infrastructure implements domain ports; routes stay thin.
3. Write tests at the appropriate level (unit for domain/application logic, integration for infrastructure against a real Postgres/Redis, API tests via `app.inject()` for routes). No PR that adds behavior without a test for it will be merged.
4. Update the relevant doc (`docs/API_REFERENCE.md`, `docs/DATABASE.md`, etc.) in the same PR — documentation debt is not deferred to "later."
5. Run the full local check before pushing:
   ```bash
   pnpm lint && pnpm typecheck && pnpm test && pnpm audit
   ```
   CI runs a required `audit` job (`pnpm audit --audit-level=high`) on every PR — a new `high`/`critical` advisory in the dependency tree (direct or transitive) fails the build. See [`docs/SECURITY.md`](./docs/SECURITY.md) § Dependency Management for the exceptions process.
6. Open a PR against `main` using the PR template's checklist, including the architecture checklist items (no duplicate implementations, no cross-module internal imports, no invented blockchain behavior).

## Commit Messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Used to drive changelog/release automation.

## Code Standards

- TypeScript strict mode, no `any` outside test files.
- No duplicate or parallel implementation of an existing entity/module left in the tree — if you're replacing something, remove the old version in the same PR (this is the single most important lesson from `PHASE_2_REFERENCE_ANALYSIS.md`).
- No module imports another module's `domain/` or `infrastructure/` directly — go through its `application/` layer.
- No placeholder/TODO-filled implementations. If something isn't ready, don't merge it half-done — scope the PR smaller instead.
- Comments explain *why*, not *what* — see the repository's general code-comment convention (non-obvious constraints only).

## Reporting Bugs / Requesting Features

Use the issue templates. For security vulnerabilities, do **not** open a public issue — see [`docs/SECURITY.md`](./docs/SECURITY.md).

## Code of Conduct

By participating, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
