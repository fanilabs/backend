import type { UserReader, WalletAddressRepository } from '../domain/index.js';
import { UserNotFoundError } from '../domain/index.js';

export interface GetMyProfileDeps {
  userReader: UserReader;
  walletAddressRepository: WalletAddressRepository;
}

export interface GetMyProfileInput {
  userId: string;
}

export interface GetMyProfileResult {
  id: string;
  email: string;
  role: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  wallets: Array<{ id: string; address: string; isPrimary: boolean; verifiedAt: Date | null }>;
}

export function createGetMyProfileUseCase(deps: GetMyProfileDeps) {
  return async function getMyProfile(input: GetMyProfileInput): Promise<GetMyProfileResult> {
    const user = await deps.userReader.findById(input.userId);
    if (!user) {
      throw new UserNotFoundError();
    }

    const wallets = await deps.walletAddressRepository.findByUserId(input.userId);

    return {
      ...user,
      wallets: wallets.map((wallet) => ({
        id: wallet.id,
        address: wallet.address,
        isPrimary: wallet.isPrimary,
        verifiedAt: wallet.verifiedAt,
      })),
    };
  };
}
