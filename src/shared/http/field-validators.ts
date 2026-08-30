import { z } from 'zod';
import { ValidationError } from '../errors/app-error.js';

/**
 * RFC 5322 (simplified/practical) email pattern — stricter than zod's
 * built-in `.email()`, which accepts some non-conformant addresses.
 */
const RFC5322_EMAIL_PATTERN =
  /^(?:[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*)@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

const BANK_CODE_PATTERN = /^\d{3}$/;

const NUBAN_ACCOUNT_NUMBER_PATTERN = /^\d{10}$/;

const NAME_MAX_LENGTH = 100;

export const rfc5322EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(RFC5322_EMAIL_PATTERN, 'must be a valid email address');

export const bankCodeSchema = z
  .string()
  .trim()
  .regex(BANK_CODE_PATTERN, 'must be a 3-digit bank code');

export const nubanAccountNumberSchema = z
  .string()
  .trim()
  .regex(NUBAN_ACCOUNT_NUMBER_PATTERN, 'must be a 10-digit NUBAN account number');

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'must not be empty')
  .max(NAME_MAX_LENGTH, `must be at most ${NAME_MAX_LENGTH} characters`);

/**
 * Runs a zod schema and, on failure, throws a `ValidationError` carrying
 * field-level messages so every caller returns the same 400 shape instead
 * of each route hand-rolling its own error formatting.
 */
export function parseOrThrowValidationError<T>(schema: z.ZodType<T>, value: unknown, context?: string): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const fieldErrors = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || context || 'value',
    message: issue.message,
  }));

  throw new ValidationError('Validation failed', { fields: fieldErrors });
}
