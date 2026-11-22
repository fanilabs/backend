# Contributing

Thanks for your interest in improving this project. This guide covers local setup, the test layers we use, and conventions for writing deterministic tests.

## Getting started

1. Install dependencies with your package manager of choice.
2. Copy the example environment file and fill in local values.
3. Set up the test database:
   ```sh
   make db-up           # Start Postgres if not running
   make db-create-test  # Create the test database
   ```
4. Run the checks before opening a pull request:
   ```sh
   make format-check  # Verify formatting (see README.md)
   make lint
   make typecheck
   make test
   ```

## Test layers

We keep three layers of tests:

- **Unit tests** exercise pure use cases and adapters in isolation, using port fakes.
- **Integration tests** exercise real repositories and infrastructure against a local database or container.
- **API tests** exercise HTTP handlers end to end through the router.

## Testing cookbook: deterministic adapter tests

Prefer the existing test seams over new infrastructure. Pure use cases should not reach for external services when a fake already exists.

### Port fakes vs. real repository tests

Port fakes implement the outbound port interface and live next to the module they serve:

- `src/modules/analytics/application/__fixtures__/fakes.ts`
- `src/modules/deliveries/application/__fixtures__/fakes.ts`

Use these when testing a use case that depends on the port. They record calls and return canned results, so assertions stay deterministic.

Real repository tests belong in the module's `infrastructure` layer and talk to an actual database. Do not substitute a fake there — the point is to verify the query and mapping against real storage.

### Deterministic addresses

When a test needs an address, use `testAddress` from `src/shared/testing/addresses.ts` instead of inventing literals. It derives a valid address from a single byte, so pass a value in the `0x00`–`0xff` range:

```ts
testAddress(0x01); // deterministic, valid address
testAddress(0xff); // still within the byte constraint
```

Passing a value outside that byte range is a bug in the test, not the helper.

### Fake timers and global mocks

Always restore fake timers and global mocks in the example lifecycle so state does not leak between tests:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('adapter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses deterministic time', () => {
    expect(Date.now()).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });
});
```

If a mock is installed once for a whole file, restore it in `afterAll` instead. Never leave `vi.useFakeTimers()` or a global spy active across files.

### Fixture naming

Name fixtures after the port or scenario they represent (for example `createAnalyticsFake` or `createDeliveriesFake`) and keep them in the module's `__fixtures__` directory. Do not create new shared event fixture infrastructure — reuse the per-module helpers.

## Pull requests

Keep changes focused, include tests for new behavior, and describe the motivation in the PR body.
