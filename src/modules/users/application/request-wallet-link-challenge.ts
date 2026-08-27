import type { ChallengeService, WalletAddressRepository } from '../domain/index.js';
import { WalletAlreadyLinkedError } from '../domain/index.js';

export interface RequestWalletLinkChallengeDeps {
  walletAddressRepository: WalletAddressRepository;
  challengeService: ChallengeService;
}

export interface RequestWalletLinkChallengeInput {
  userId: string;
  address: string;
}

export interface RequestWalletLinkChallengeResult {
  challenge: string;
}

export function createRequestWalletLinkChallengeUseCase(deps: RequestWalletLinkChallengeDeps) {
  return async function requestWalletLinkChallenge(
    input: RequestWalletLinkChallengeInput,
  ): Promise<RequestWalletLinkChallengeResult> {
    const existing = await deps.walletAddressRepository.findByAddress(input.address);
    if (existing && existing.userId !== input.userId) {
      throw new WalletAlreadyLinkedError(input.address);
    }

    const challenge = deps.challengeService.issueWalletLinkChallenge(input.userId, input.address);
    return { challenge };
  };
}
