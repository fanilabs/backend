import type { WalletAddressRecord, WalletAddressRepository } from '../domain/index.js';

export interface ListWalletsDeps {
  walletAddressRepository: WalletAddressRepository;
}

export interface ListWalletsInput {
  userId: string;
}

export function createListWalletsUseCase(deps: ListWalletsDeps) {
  return async function listWallets(input: ListWalletsInput): Promise<WalletAddressRecord[]> {
    return deps.walletAddressRepository.findByUserId(input.userId);
  };
}
