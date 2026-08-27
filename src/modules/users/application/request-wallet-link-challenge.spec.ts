import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRequestWalletLinkChallengeUseCase } from './request-wallet-link-challenge.js';
import { WalletAlreadyLinkedError } from '../domain/index.js';
import {
  createFakeChallengeService,
  createInMemoryWalletAddressRepository,
} from './__fixtures__/fakes.js';

describe('requestWalletLinkChallenge', () => {
  it('issues a challenge for an unlinked address', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const challengeService = createFakeChallengeService();
    const requestChallenge = createRequestWalletLinkChallengeUseCase({
      walletAddressRepository,
      challengeService,
    });

    const result = await requestChallenge({ userId: randomUUID(), address: 'GABC...' });

    expect(result.challenge).toBeTruthy();
  });

  it('allows re-requesting a challenge for an address already linked to the same user', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const challengeService = createFakeChallengeService();
    const userId = randomUUID();
    await walletAddressRepository.create({
      userId,
      address: 'GABC...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const requestChallenge = createRequestWalletLinkChallengeUseCase({
      walletAddressRepository,
      challengeService,
    });

    await expect(requestChallenge({ userId, address: 'GABC...' })).resolves.toBeTruthy();
  });

  it('rejects an address already linked to a different user', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const challengeService = createFakeChallengeService();
    await walletAddressRepository.create({
      userId: randomUUID(),
      address: 'GABC...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const requestChallenge = createRequestWalletLinkChallengeUseCase({
      walletAddressRepository,
      challengeService,
    });

    await expect(requestChallenge({ userId: randomUUID(), address: 'GABC...' })).rejects.toThrow(
      WalletAlreadyLinkedError,
    );
  });
});
