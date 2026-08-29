import { describe, expect, it } from 'vitest';
import { selectNotificationSender } from './select-notification-sender.js';

describe('selectNotificationSender', () => {
  it('returns the logger sender in development', () => {
    const sender = selectNotificationSender('development', 'logger');
    expect(sender.send).toBeTypeOf('function');
  });

  it('returns the logger sender in test', () => {
    const sender = selectNotificationSender('test', 'logger');
    expect(sender.send).toBeTypeOf('function');
  });

  it('throws a clear configuration error for logger in production', () => {
    expect(() => selectNotificationSender('production', 'logger')).toThrow(/NODE_ENV=production/);
  });
});
