import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createListWalletsUseCase } from './list-wallets.js';
import { createInMemoryWalletAddressRepository } from './__fixtures__/fakes.js';

describe('listWallets', () => {
  it('returns only the requesting user’s wallets', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const userId = randomUUID();
    await walletAddressRepository.create({
      userId,
      address: 'GMINE...',
      isPrimary: true,
      verifiedAt: new Date(),
    });
    await walletAddressRepository.create({
      userId: randomUUID(),
      address: 'GSOMEONEELSE...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const listWallets = createListWalletsUseCase({ walletAddressRepository });
    const result = await listWallets({ userId });

    expect(result).toHaveLength(1);
    expect(result[0]?.address).toBe('GMINE...');
  });
});
