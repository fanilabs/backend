import type { WalletAddressRecord, WalletAddressRepository } from '../domain/index.js';

export interface ListWalletsDeps {
  walletAddressRepository: WalletAddressRepository;
}

export interface ListWalletsInput {
  userId: string;
}

/**
 * Creates a use case that lists the wallets linked to a user.
 * @param deps - The wallet address repository used to retrieve the user's wallets.
 */
export function createListWalletsUseCase(deps: ListWalletsDeps) {
  return async function listWallets(input: ListWalletsInput): Promise<WalletAddressRecord[]> {
    return deps.walletAddressRepository.findByUserId(input.userId);
  };
}
