import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createUnlinkWalletUseCase } from './unlink-wallet.js';
import { ForbiddenWalletAccessError, WalletNotFoundError } from '../domain/index.js';
import { createInMemoryWalletAddressRepository } from './__fixtures__/fakes.js';

describe('unlinkWallet', () => {
  it('removes a wallet owned by the requesting user', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const userId = randomUUID();
    const wallet = await walletAddressRepository.create({
      userId,
      address: 'GABC...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const unlinkWallet = createUnlinkWalletUseCase({ walletAddressRepository });
    await unlinkWallet({ userId, walletId: wallet.id });

    expect(await walletAddressRepository.findById(wallet.id)).toBeNull();
  });

  it('rejects an unknown wallet id', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const unlinkWallet = createUnlinkWalletUseCase({ walletAddressRepository });

    await expect(unlinkWallet({ userId: randomUUID(), walletId: randomUUID() })).rejects.toThrow(
      WalletNotFoundError,
    );
  });

  it('rejects unlinking a wallet that belongs to a different user', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const wallet = await walletAddressRepository.create({
      userId: randomUUID(),
      address: 'GABC...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const unlinkWallet = createUnlinkWalletUseCase({ walletAddressRepository });
    await expect(unlinkWallet({ userId: randomUUID(), walletId: wallet.id })).rejects.toThrow(
      ForbiddenWalletAccessError,
    );
  });
});
