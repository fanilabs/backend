import { describe, expect, it, vi } from 'vitest';
import { createDeliveryLegacyProfileReader } from './delivery-legacy-profile-reader.js';
import type { SorobanClient } from '../../../shared/stellar/index.js';

vi.mock('../../../shared/stellar/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/stellar/index.js')>();
  return {
    ...actual,
    simulateReadCall: vi.fn(),
  };
});

const { simulateReadCall } = await import('../../../shared/stellar/index.js');

const client = {} as SorobanClient;
const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

describe('createDeliveryLegacyProfileReader', () => {
  it('returns the deliveries_completed count from the legacy profile', async () => {
    vi.mocked(simulateReadCall).mockResolvedValueOnce({ deliveries_completed: 7 });

    const reader = createDeliveryLegacyProfileReader(client);
    await expect(reader.getLegacyDeliveriesCompleted(address)).resolves.toBe(7);
  });

  it('returns 0 when the driver has no legacy profile (null)', async () => {
    vi.mocked(simulateReadCall).mockResolvedValueOnce(null);

    const reader = createDeliveryLegacyProfileReader(client);
    await expect(reader.getLegacyDeliveriesCompleted(address)).resolves.toBe(0);
  });

  it('throws when the contract returns an unexpected non-object shape', async () => {
    vi.mocked(simulateReadCall).mockResolvedValueOnce(42);

    const reader = createDeliveryLegacyProfileReader(client);
    await expect(reader.getLegacyDeliveriesCompleted(address)).rejects.toThrow(
      'Expected delivery_contract.get_driver_profile to return an object',
    );
  });
});
