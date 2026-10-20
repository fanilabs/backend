import { describe, expect, it } from 'vitest';
import { runProbeWithTimeout } from './health.js';

describe('runProbeWithTimeout (#433)', () => {
  it('returns error when a database or Redis probe hangs past timeoutMs', async () => {
    const result = await runProbeWithTimeout(() => new Promise(() => {}), 30);
    expect(result).toBe('error');
  });

  it('returns ok when probe resolves within timeoutMs', async () => {
    const result = await runProbeWithTimeout(async () => 1, 200);
    expect(result).toBe('ok');
  });
});
