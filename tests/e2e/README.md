# End-to-End (E2E) Tests

This directory contains the Playwright E2E suites for the application. They run against a dedicated E2E configuration and exercise the real UI, routing, and state management layers, while chain interactions are supplied by injected fixtures.

## Prerequisites

- Node.js and dependencies installed (`npm install`).
- A running application instance reachable at the base URL configured for the E2E project.
- The dedicated E2E Playwright config (not the default config) — it defines the `testDir`, base URL, and web server used by these suites.

## Running the suites

```bash
# Run all E2E suites with the dedicated E2E config
npx playwright test --config=tests/e2e/playwright.e2e.config.ts

# Run a single suite
npx playwright test --config=tests/e2e/playwright.e2e.config.ts tests/e2e/happy-path.e2e.spec.ts
```

## Suite coverage

| Suite | What is exercised for real | Injected / fixture dependencies | Limitations |
| --- | --- | --- | --- |
| `app.e2e.spec.ts` | App shell, routing, navigation, and smoke-level rendering of core pages. | Chain reads are not exercised; no contract-reader fixtures are injected. | Smoke coverage only — does not drive cross-module flows. |
| `happy-path.e2e.spec.ts` | Cross-module happy-path flow: UI, routing, state management, and module interactions driven end to end. | Contract-reader fixtures are injected to supply chain reads. | Chain operations are fixtures; no live chain or deployed contract is contacted. |
| `dispute-flow.e2e.spec.ts` | Cross-module dispute flow: UI, routing, state management, and dispute-related module interactions. | Contract-reader fixtures are injected to supply chain reads. | Chain operations are fixtures; no live chain or deployed contract is contacted. |

## Honest availability notes

- The two flow suites (`happy-path.e2e.spec.ts` and `dispute-flow.e2e.spec.ts`) are fixture-driven: they inject contract-reader fixtures and drive cross-module behavior, but they do **not** execute real chain operations.
- Because contract reads are mocked/fixture-backed, passing these suites does **not** certify compatibility with deployed contracts. Deployed-contract compatibility must be verified separately against a real chain.
- `app.e2e.spec.ts` remains a smoke suite and does not cover the full flows.

## Known blockers

- Full live-chain E2E coverage (real contract reads and writes against a deployed environment) is not yet available in this harness.
- Until that exists, treat the flow suites as regression coverage for UI and module wiring, not as chain-integration certification.
