import { describe, expect, it } from 'vitest';
import { getFleetQuerySchema } from './schemas.js';

describe('getFleetQuerySchema', () => {
  describe('includeRemoved coercion', () => {
    it('keeps the string "false" as boolean false', () => {
      const result = getFleetQuerySchema.parse({ includeRemoved: 'false' });
      expect(result.includeRemoved).toBe(false);
    });

    it('parses the string "true" as boolean true', () => {
      const result = getFleetQuerySchema.parse({ includeRemoved: 'true' });
      expect(result.includeRemoved).toBe(true);
    });

    it('defaults includeRemoved to false when omitted', () => {
      const result = getFleetQuerySchema.parse({});
      expect(result.includeRemoved).toBe(false);
    });

    it('rejects invalid boolean strings', () => {
      expect(() => getFleetQuerySchema.parse({ includeRemoved: 'yes' })).toThrow();
      expect(() => getFleetQuerySchema.parse({ includeRemoved: '1' })).toThrow();
      expect(() => getFleetQuerySchema.parse({ includeRemoved: '' })).toThrow();
    });
  });

  describe('driverLimit coercion', () => {
    it('defaults driverLimit to 100 when omitted', () => {
      const result = getFleetQuerySchema.parse({});
      expect(result.driverLimit).toBe(100);
    });

    it('coerces a numeric string to a number', () => {
      const result = getFleetQuerySchema.parse({ driverLimit: '250' });
      expect(result.driverLimit).toBe(250);
    });

    it('accepts the maximum of 500', () => {
      const result = getFleetQuerySchema.parse({ driverLimit: '500' });
      expect(result.driverLimit).toBe(500);
    });

    it('rejects values above the 500 cap', () => {
      expect(() => getFleetQuerySchema.parse({ driverLimit: '501' })).toThrow();
    });

    it('rejects fractional values', () => {
      expect(() => getFleetQuerySchema.parse({ driverLimit: '1.5' })).toThrow();
    });

    it('rejects zero and negative values', () => {
      expect(() => getFleetQuerySchema.parse({ driverLimit: '0' })).toThrow();
      expect(() => getFleetQuerySchema.parse({ driverLimit: '-1' })).toThrow();
    });
  });
});
