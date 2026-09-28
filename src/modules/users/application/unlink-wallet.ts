import type { WalletAddressRepository } from '../domain/index.js';
import { ForbiddenWalletAccessError, WalletNotFoundError } from '../domain/index.js';

export interface UnlinkWalletDeps {
  walletAddressRepository: WalletAddressRepository;
}

export interface UnlinkWalletInput {
  userId: string;
  walletId: string;
}

/**
 * Creates the use case that unlinks a wallet address from a user.
 *
 * The returned use case loads the wallet by id, verifies that it belongs to
 * the requesting user, and removes it from the repository. It throws
 * {@link WalletNotFoundError} when no wallet matches the given id and
 * {@link ForbiddenWalletAccessError} when the wallet belongs to another user.
 *
 * @param deps - Dependencies required by the use case.
 * @param deps.walletAddressRepository - Repository used to look up and remove wallet addresses.
 * @returns An async function that takes an {@link UnlinkWalletInput} and resolves once the wallet has been unlinked.
 */
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
