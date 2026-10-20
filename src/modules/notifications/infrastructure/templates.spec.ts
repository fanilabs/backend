import { describe, expect, it } from 'vitest';
import { renderNotificationTemplate } from './templates.js';

describe('renderNotificationTemplate (#410)', () => {
  it('generates both non-empty html and plain-text bodies with no raw HTML tags in text', () => {
    const rendered = renderNotificationTemplate('delivery.driver_assigned', {
      chainDeliveryId: '42',
      driverAddress: 'GDRIVER',
    });

    expect(rendered.subject).toContain('delivery.driver_assigned');
    expect(rendered.text).toContain('chainDeliveryId: 42');
    expect(rendered.text).not.toMatch(/<[^>]+>/);
    expect(rendered.html).toContain('<!DOCTYPE html>');
    expect(rendered.html).toContain('chainDeliveryId');
  });
});
