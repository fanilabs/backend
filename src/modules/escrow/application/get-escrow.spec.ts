import { describe, expect, it } from 'vitest';
import { createGetEscrowUseCase } from './get-escrow.js';
import { EscrowNotFoundError } from '../domain/index.js';
import { buildEscrow, createInMemoryEscrowRepository } from './__fixtures__/fakes.js';

describe('getEscrow', () => {
  it('returns the escrow by chain delivery id', async () => {
    const escrowRepository = createInMemoryEscrowRepository();
    escrowRepository.seed(buildEscrow({ chainDeliveryId: 42n }));

    const getEscrow = createGetEscrowUseCase({ escrowRepository });
    const result = await getEscrow({ chainDeliveryId: 42n });

    expect(result.chainDeliveryId).toBe(42n);
  });

  it('rejects an unknown chain delivery id', async () => {
    const escrowRepository = createInMemoryEscrowRepository();
    const getEscrow = createGetEscrowUseCase({ escrowRepository });

    await expect(getEscrow({ chainDeliveryId: 999n })).rejects.toThrow(EscrowNotFoundError);
  });
});
