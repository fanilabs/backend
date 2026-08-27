import type { WalletAddressRepository } from '../domain/index.js';
import { ForbiddenWalletAccessError, WalletNotFoundError } from '../domain/index.js';

export interface UnlinkWalletDeps {
  walletAddressRepository: WalletAddressRepository;
}

export interface UnlinkWalletInput {
  userId: string;
  walletId: string;
}

export function createUnlinkWalletUseCase(deps: UnlinkWalletDeps) {
  return async function unlinkWallet(input: UnlinkWalletInput): Promise<void> {
    const wallet = await deps.walletAddressRepository.findById(input.walletId);
    if (!wallet) {
      throw new WalletNotFoundError();
    }
    if (wallet.userId !== input.userId) {
      throw new ForbiddenWalletAccessError();
    }

    await deps.walletAddressRepository.remove(wallet.id);
  };
}
