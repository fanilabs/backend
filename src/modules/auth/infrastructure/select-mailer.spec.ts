import { describe, expect, it } from 'vitest';
import { selectMailer } from './select-mailer.js';

describe('selectMailer', () => {
  it('returns the logger mailer in development', () => {
    const mailer = selectMailer('development', 'logger');
    expect(mailer.sendVerificationEmail).toBeTypeOf('function');
  });

  it('returns the logger mailer in test', () => {
    const mailer = selectMailer('test', 'logger');
    expect(mailer.sendVerificationEmail).toBeTypeOf('function');
  });

  it('throws a clear configuration error for logger in production', () => {
    expect(() => selectMailer('production', 'logger')).toThrow(/NODE_ENV=production/);
  });
});
