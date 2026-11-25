// #470: Return 404 for unindexed drivers
export function nativeToChainDriverProfile(native: unknown): ChainDriverProfile {
  if (native === null) throw new DriverProfileNotFoundError();
  const record = native as Record<string, unknown>;
  return { /* map */ };
}
