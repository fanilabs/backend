# Contributing

Thanks for your interest in improving this project. This guide covers local setup, the test layers we use, and conventions for writing deterministic tests.

## Getting started

1. Install dependencies with your package manager of choice.
2. Copy the example environment file and fill in local values.
3. Run the test suite before opening a pull request.

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

## ESM import specifiers

This repository uses `"module": "NodeNext"` and `"moduleResolution": "NodeNext"` in `tsconfig.json`. Node's ESM loader resolves specifiers literally from the compiled output — it does **not** strip `.ts` extensions or add `.js` for you.

### The rule

Always write relative imports with a `.js` extension, even though the source file is `.ts`:

```ts
// ✅ correct — matches the emitted filename
import { successResponse } from '../http/response-envelope.js';

// ❌ wrong — works in some tsx dev-loader setups but fails after `tsc` emission
import { successResponse } from '../http/response-envelope';
```

### Why `tsx` alone is not enough

Running `tsx` during development uses a loader that transparently maps `.js` → `.ts` at import time. This masks missing `.js` extensions. The only way to verify imports survive compilation is to run `pnpm build` and inspect `dist/`. A green `tsx` run does not guarantee the build output resolves correctly.

### Validating your imports

```bash
pnpm build          # compiles src/ → dist/ with tsc
node dist/server.js # fails fast on any unresolvable specifier
```

### Type-only imports

Use `import type` for imports that exist only for type-checking:

```ts
import type { FastifyInstance } from 'fastify';
```

This keeps emitted output clean — `import type` is erased entirely by `tsc`.

### Package imports

Bare specifiers (no leading `./` or `../`) resolve through `node_modules` as usual and do not need a `.js` suffix:

```ts
import Fastify from 'fastify'; // ✅ bare specifier, no extension needed
```
