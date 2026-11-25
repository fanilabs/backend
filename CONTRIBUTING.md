# Contributing

Thanks for your interest in improving this project. This guide covers local setup, the checks we run in CI, and the conventions we follow.

## Getting started

1. Install dependencies with your package manager of choice.
2. Copy any example environment file to a local `.env` and fill in the values you need.
3. Run the test suite before opening a pull request.

## Tests and coverage

We use [Vitest](https://vitest.dev/) for unit and integration tests. Coverage is collected with the V8 provider and reported in `lcov` format.

### Coverage denominator

Coverage totals are meant to measure **production code only**. Test-support code — fixture construction and test environment setup — is excluded from the reported denominator so it neither earns credit nor incurs penalties.

Concretely, `vitest.config.ts`:

- includes `src/**/*.ts` as the coverage surface,
- excludes spec files and barrel (`index.ts`) files,
- excludes test-support directories: `**/__fixtures__/**` and `src/shared/testing/**`.

Module composition roots (for example a module's `index.ts` wiring) remain part of the coverage surface and must not be excluded.

### Thresholds

Coverage thresholds are enforced in CI. Do **not** lower thresholds to compensate for changes in the denominator — if totals shift, add tests for the production code that is now being measured.

### Verifying the denominator

When changing coverage configuration, compare the file list in the generated `lcov` report before and after on the same source. Confirm that:

- no `__fixtures__` or `shared/testing` sources appear in `lcov`,
- module composition roots still appear in `lcov`,
- a temporary production module added to `src/` is still included.

## Pull requests

- Keep changes focused; one concern per pull request where practical.
- Describe the motivation and the behavior change in the PR body.
- Make sure the full test suite and coverage checks pass locally before requesting review.
