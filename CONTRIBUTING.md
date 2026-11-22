# Contributing

Thanks for your interest in improving this project. This guide covers local setup, the test layers we use, and conventions for writing deterministic tests.

## Getting started

1. Select the pinned package manager (see [Package manager](#package-manager)).
2. Install dependencies with `pnpm install --frozen-lockfile`.
3. Copy the example environment file and fill in local values.
4. Run the test suite before opening a pull request.

## Package manager

The `packageManager` field in `package.json` is the authoritative source for the pnpm version contributors must use. CI selects the same release, so a fresh checkout should match it exactly.

The `engines` range (for example `pnpm >=9`) is only a minimum compatibility floor — it is not the recommended or tested toolchain. Do not treat it as the version to install.

### Selecting the pinned release

Read the pin from `package.json` and activate it with Corepack. For the current pin (`pnpm@10.33.0`):

```sh
corepack prepare pnpm@10.33.0 --activate
```

This only selects the package manager release; it does not change any dependency versions in `package.json` or the lockfile.

### Verifying before installing

Confirm the active version matches the pin before installing:

```sh
pnpm --version   # must print 10.33.0
pnpm install --frozen-lockfile
```

If `pnpm --version` does not match the `packageManager` field, re-run the `corepack prepare` command above before continuing.

### Refreshing this guide when the pin changes

When the `packageManager` field in `package.json` is bumped, update the version in the `corepack prepare` command and the expected `pnpm --version` output in this section to match. Keep the `engines` range as the minimum floor unless the supported baseline itself changes.

## Editor setup

The workspace recommends the Prisma extension (see `.vscode/extensions.json`). Prisma schema files (`prisma/schema.prisma`) format on save with the Prisma formatter via a `[prisma]` override in `.vscode/settings.json`; all other languages keep Prettier as the default formatter. No per-user formatter setting is required.

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
