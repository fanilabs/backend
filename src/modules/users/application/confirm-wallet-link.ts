import type {
  ChallengeService,
  SignatureVerifier,
  WalletAddressRecord,
  WalletAddressRepository,
} from '../domain/index.js';
import {
  InvalidWalletChallengeError,
  InvalidWalletSignatureError,
  WalletAlreadyLinkedError,
} from '../domain/index.js';

export interface ConfirmWalletLinkDeps {
  walletAddressRepository: WalletAddressRepository;
  challengeService: ChallengeService;
  signatureVerifier: SignatureVerifier;
}

export interface ConfirmWalletLinkInput {
  userId: string;
  address: string;
  challenge: string;
  signature: string;
}

/**
 * Verifies (a) the challenge is a genuine, unexpired token issued for
 * exactly this user+address pair, and (b) the presented signature proves
 * control of the wallet's private key for that same challenge string — both
 * must hold before a wallet is ever linked.
 */
export function createConfirmWalletLinkUseCase(deps: ConfirmWalletLinkDeps) {
  return async function confirmWalletLink(
    input: ConfirmWalletLinkInput,
  ): Promise<WalletAddressRecord> {
    let verifiedChallenge;
    try {
      verifiedChallenge = deps.challengeService.verifyWalletLinkChallenge(input.challenge);
    } catch {
      throw new InvalidWalletChallengeError();
    }

    if (verifiedChallenge.userId !== input.userId || verifiedChallenge.address !== input.address) {
      throw new InvalidWalletChallengeError();
    }

    const signatureValid = deps.signatureVerifier.verify(
      input.address,
      input.challenge,
      input.signature,
    );
    if (!signatureValid) {
      throw new InvalidWalletSignatureError();
    }

    const existing = await deps.walletAddressRepository.findByAddress(input.address);
    if (existing) {
      if (existing.userId !== input.userId) {
        throw new WalletAlreadyLinkedError(input.address);
      }
      return existing; // already linked to this same user — idempotent success
    }

    const currentWallets = await deps.walletAddressRepository.findByUserId(input.userId);
    return deps.walletAddressRepository.create({
      userId: input.userId,
      address: input.address,
      isPrimary: currentWallets.length === 0,
      verifiedAt: new Date(),
    });
  };
}
