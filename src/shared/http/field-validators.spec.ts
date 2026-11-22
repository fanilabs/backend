import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  bankCodeSchema,
  nameSchema,
  nubanAccountNumberSchema,
  parseOrThrowValidationError,
  rfc5322EmailSchema,
} from './field-validators.js';
import { ValidationError } from '../errors/app-error.js';

describe('field validators', () => {
  it('normalizes valid emails and enforces the practical length limit', () => {
    expect(rfc5322EmailSchema.parse('  Ada.Lovelace@Example.COM  ')).toBe('ada.lovelace@example.com');

    const tooLong = `${'a'.repeat(243)}@example.com`;
    expect(() => rfc5322EmailSchema.parse(tooLong)).toThrow();
  });

  it('trims bank codes and preserves leading zeros', () => {
    expect(bankCodeSchema.parse(' 007 ')).toBe('007');
    expect(() => bankCodeSchema.parse('07')).toThrow();
    expect(() => bankCodeSchema.parse('0007')).toThrow();
  });

  it('trims NUBAN account numbers and preserves leading zeros', () => {
    expect(nubanAccountNumberSchema.parse(' 0012345678 ')).toBe('0012345678');
    expect(() => nubanAccountNumberSchema.parse('123456789')).toThrow();
  });

  it('trims names and rejects empty or overlong values', () => {
    expect(nameSchema.parse('  Ada Lovelace  ')).toBe('Ada Lovelace');
    expect(() => nameSchema.parse('   ')).toThrow();
    expect(() => nameSchema.parse('a'.repeat(101))).toThrow();
  });
});

describe('parseOrThrowValidationError', () => {
  const profileSchema = z.object({ name: nameSchema });

  it('returns transformed data on success', () => {
    expect(parseOrThrowValidationError(profileSchema, { name: '  Ada  ' })).toEqual({ name: 'Ada' });
  });

  it('reports nested field paths with the validation error contract', () => {
    try {
      parseOrThrowValidationError(z.object({ profile: profileSchema }), { profile: { name: '' } });
      throw new Error('expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        details: { fields: [{ field: 'profile.name', message: 'must not be empty' }] },
      });
    }
  });

  it('uses supplied context and the value fallback for root errors', () => {
    expect(() => parseOrThrowValidationError(z.string().min(3), 'x', 'displayName')).toThrowError(
      ValidationError
    );

    try {
      parseOrThrowValidationError(z.string().min(3), 'x', 'displayName');
    } catch (error) {
      expect(error).toMatchObject({ details: { fields: [{ field: 'displayName' }] } });
    }

    try {
      parseOrThrowValidationError(z.string().min(3), 'x');
    } catch (error) {
      expect(error).toMatchObject({ details: { fields: [{ field: 'value' }] } });
    }
  });
});

