# Fix: Add Timeout and Fallback to Redis Disconnect (#355)

## Problem
In `src/shared/cache/redis-client.ts`, the `disconnectRedis()` function executed `await current?.quit()` without a timeout or fallback to `client.disconnect()`, causing the process to hang indefinitely if Redis was unresponsive during shutdown.

During server termination (e.g., SIGTERM from Docker or Kubernetes), graceful shutdown has a hard timeout. If `quit()` hung, the process was forcibly killed with SIGKILL, preventing remaining cleanups and leaving orphaned connections.

## Solution
Applied the same timeout and fallback pattern already implemented in `src/shared/queue/connection.ts` to `src/shared/cache/redis-client.ts`.

### Changes Made

#### 1. `src/shared/cache/redis-client.ts`
- Added import of `withTimeout` from `src/shared/shutdown/index.js`
- Introduced `REDIS_DISCONNECT_TIMEOUT_MS = 3_000` constant to define the timeout period (matching the queue connection timeout)
- Updated `disconnectRedis()` to wrap `quit()` with a timeout
- Added fallback to `client.disconnect()` if `quit()` times out or rejects
- Added structured logging to warn when the fallback is triggered

**Before:**
```typescript
export async function disconnectRedis(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.quit();
}
```

**After:**
```typescript
export const REDIS_DISCONNECT_TIMEOUT_MS = 3_000;

export async function disconnectRedis(): Promise<void> {
  const current = client;
  client = undefined;
  if (!current) return;
  try {
    await withTimeout(() => current.quit(), REDIS_DISCONNECT_TIMEOUT_MS, 'Redis');
  } catch (error: unknown) {
    // Best-effort teardown: if QUIT hangs (unreachable Redis) or rejects,
    // drop the socket outright so shutdown is never held hostage by a
    // connection that can no longer complete a round-trip (#355).
    log.warn({ err: error }, 'Redis quit did not complete — force disconnecting socket');
    current.disconnect();
  }
}
```

#### 2. `src/shared/cache/index.ts`
- Exported the new `REDIS_DISCONNECT_TIMEOUT_MS` constant for external use if needed

## Behavior

### Nominal Case (Redis Responsive)
1. `disconnectRedis()` calls `quit()` on the Redis client
2. Redis server receives the QUIT command and closes the connection gracefully
3. Operation completes within the 3-second timeout
4. Process continues with remaining shutdown steps

### Timeout Case (Redis Unresponsive or Network Latency)
1. `disconnectRedis()` calls `quit()` on the Redis client
2. After 3 seconds with no response, `withTimeout()` rejects
3. Catch block logs a warning and calls `client.disconnect()` to force-close the socket
4. Process continues with remaining shutdown steps without waiting indefinitely

### Error Case (Redis Rejects quit())
1. `disconnectRedis()` calls `quit()` on the Redis client
2. Redis rejects the promise (connection lost, Redis is shutting down, etc.)
3. Catch block logs a warning and calls `client.disconnect()` as fallback
4. Process continues with remaining shutdown steps

## Impact

- **Graceful Shutdown**: Process shutdown is no longer held hostage by unresponsive Redis connections
- **Consistency**: Both cache and queue Redis connections now use the same timeout and fallback pattern
- **Observability**: Fallback scenarios are logged at WARN level for debugging
- **Resilience**: Orphaned connections are avoided by forcefully disconnecting when graceful shutdown fails

## Testing

The integration test `src/shared/http/routes/observability-routes.integration.spec.ts` exercises the disconnect flow and validates that all connections are properly closed.

When the Redis server is unreachable during shutdown:
- The process will log a WARN message: "Redis quit did not complete — force disconnecting socket"
- The process will continue shutting down instead of hanging
- The remaining shutdown steps (Prisma, queue) will complete normally

## Related Issues

- #355: Process hangs on shutdown when Redis is unresponsive
- #289, #294: Similar timeout handling for other connections (Prisma, queue)

## Files Changed

1. `src/shared/cache/redis-client.ts` - Added timeout and fallback logic
2. `src/shared/cache/index.ts` - Exported timeout constant
