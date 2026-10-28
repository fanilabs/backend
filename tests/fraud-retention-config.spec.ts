import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/shared/config/env.js';

const fixture = {
  DATABASE_URL: 'postgresql://fixture:fixture@localhost:9/fixture',
  REDIS_URL: 'redis://localhost:9',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};
const windows = [
  'FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS',
  'FRAUD_ESCROW_VELOCITY_WINDOW_HOURS',
  'FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS',
] as const;

describe('fraud retention configuration', () => {
  it('preserves the documented defaults', () => {
    const env = parseEnv(fixture);
    expect(env.FRAUD_ACTIVITY_RETENTION_DAYS).toBe(30);
    expect(windows.map((key) => env[key])).toEqual([1, 1, 24]);
  });

  it.each(windows)('rejects retention shorter than %s with an actionable error', (key) => {
    expect(() => parseEnv({ ...fixture, FRAUD_ACTIVITY_RETENTION_DAYS: '1', [key]: '25' })).toThrow(
      new RegExp(`${key}.*25.*FRAUD_ACTIVITY_RETENTION_DAYS.*1`),
    );
  });

  it.each(windows)('accepts equality for %s without clamping either value', (key) => {
    const env = parseEnv({ ...fixture, FRAUD_ACTIVITY_RETENTION_DAYS: '2', [key]: '48' });
    expect(env.FRAUD_ACTIVITY_RETENTION_DAYS).toBe(2);
    expect(env[key]).toBe(48);
  });

  it('reports every conflicting enabled rule and never silently extends retention', () => {
    expect(() =>
      parseEnv({
        ...fixture,
        FRAUD_ACTIVITY_RETENTION_DAYS: '1',
        FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS: '48',
        FRAUD_ESCROW_VELOCITY_WINDOW_HOURS: '72',
        FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS: '96',
      }),
    ).toThrow(
      /FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS[\s\S]*FRAUD_ESCROW_VELOCITY_WINDOW_HOURS[\s\S]*FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS/,
    );
  });

  it('preserves valid explicit thresholds, windows and retention', () => {
    const env = parseEnv({
      ...fixture,
      FRAUD_ACTIVITY_RETENTION_DAYS: '3',
      FRAUD_DELIVERY_VELOCITY_WINDOW_HOURS: '48',
      FRAUD_DELIVERY_VELOCITY_THRESHOLD: '2',
      FRAUD_ESCROW_VELOCITY_WINDOW_HOURS: '72',
      FRAUD_ESCROW_VELOCITY_THRESHOLD: '4',
      FRAUD_DISPUTE_VELOCITY_WINDOW_HOURS: '24',
      FRAUD_DISPUTE_VELOCITY_THRESHOLD: '6',
    });
    expect(env.FRAUD_ACTIVITY_RETENTION_DAYS).toBe(3);
    expect(windows.map((key) => env[key])).toEqual([48, 72, 24]);
    expect([
      env.FRAUD_DELIVERY_VELOCITY_THRESHOLD,
      env.FRAUD_ESCROW_VELOCITY_THRESHOLD,
      env.FRAUD_DISPUTE_VELOCITY_THRESHOLD,
    ]).toEqual([2, 4, 6]);
  });
});
