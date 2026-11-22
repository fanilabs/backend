# CI Job Timeout Configuration (#604)

Each GitHub Actions workflow job should terminate within an explicit time budget.

## Recommended Timeouts

Add `timeout-minutes` to job definitions:

```yaml
jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 15  # Lint, build, unit tests
    # ...

  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30  # Database-backed E2E suites
    # ...

  release:
    runs-on: ubuntu-latest
    timeout-minutes: 20  # Build and publish
    # ...
```

This ensures stuck operations (install, external calls) respect repository budgets rather than relying on GitHub runner defaults.
