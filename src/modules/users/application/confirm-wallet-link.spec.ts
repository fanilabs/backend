import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createConfirmWalletLinkUseCase } from './confirm-wallet-link.js';
import {
  InvalidWalletChallengeError,
  InvalidWalletSignatureError,
  WalletAlreadyLinkedError,
} from '../domain/index.js';
import {
  createFakeChallengeService,
  createFakeSignatureVerifier,
  createInMemoryWalletAddressRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const walletAddressRepository = createInMemoryWalletAddressRepository();
  const challengeService = createFakeChallengeService();
  const signatureVerifier = createFakeSignatureVerifier();
  const confirmWalletLink = createConfirmWalletLinkUseCase({
    walletAddressRepository,
    challengeService,
    signatureVerifier,
  });
  return { walletAddressRepository, challengeService, confirmWalletLink };
}

describe('confirmWalletLink', () => {
  it('links a new wallet as primary when it is the user’s first', async () => {
    const { challengeService, confirmWalletLink, walletAddressRepository } = setup();
    const userId = randomUUID();
    const address = 'GABC...';
    const challenge = challengeService.issuedFor(userId, address, Date.now() + 60_000);

    const wallet = await confirmWalletLink({
      userId,
      address,
      challenge,
      signature: `valid-signature-for:${challenge}`,
    });

    expect(wallet.isPrimary).toBe(true);
    expect(wallet.verifiedAt).not.toBeNull();
    expect(await walletAddressRepository.findByAddress(address)).toMatchObject({ userId });
  });

  it('links a second wallet as non-primary', async () => {
    const { challengeService, confirmWalletLink, walletAddressRepository } = setup();
    const userId = randomUUID();
    await walletAddressRepository.create({
      userId,
      address: 'GFIRST...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const address = 'GSECOND...';
    const challenge = challengeService.issuedFor(userId, address, Date.now() + 60_000);
    const wallet = await confirmWalletLink({
      userId,
      address,
      challenge,
      signature: `valid-signature-for:${challenge}`,
    });

    expect(wallet.isPrimary).toBe(false);
  });

  it('is idempotent when re-confirming the same user’s already-linked wallet', async () => {
    const { challengeService, confirmWalletLink } = setup();
    const userId = randomUUID();
    const address = 'GABC...';
    const challenge = challengeService.issuedFor(userId, address, Date.now() + 60_000);
    const signature = `valid-signature-for:${challenge}`;

    await confirmWalletLink({ userId, address, challenge, signature });
    await expect(
      confirmWalletLink({ userId, address, challenge, signature }),
    ).resolves.toMatchObject({
      userId,
      address,
    });
  });

  it('rejects a challenge issued for a different address', async () => {
    const { challengeService, confirmWalletLink } = setup();
    const userId = randomUUID();
    const challenge = challengeService.issuedFor(userId, 'GOTHER...', Date.now() + 60_000);

    await expect(
      confirmWalletLink({
        userId,
        address: 'GABC...',
        challenge,
        signature: `valid-signature-for:${challenge}`,
      }),
    ).rejects.toThrow(InvalidWalletChallengeError);
  });

  it('rejects an expired challenge', async () => {
    const { challengeService, confirmWalletLink } = setup();
    const userId = randomUUID();
    const address = 'GABC...';
    const challenge = challengeService.issuedFor(userId, address, Date.now() - 1000);

    await expect(
      confirmWalletLink({
        userId,
        address,
        challenge,
        signature: `valid-signature-for:${challenge}`,
      }),
    ).rejects.toThrow(InvalidWalletChallengeError);
  });

  it('rejects an invalid signature', async () => {
    const { challengeService, confirmWalletLink } = setup();
    const userId = randomUUID();
    const address = 'GABC...';
    const challenge = challengeService.issuedFor(userId, address, Date.now() + 60_000);

    await expect(
      confirmWalletLink({ userId, address, challenge, signature: 'totally-wrong' }),
    ).rejects.toThrow(InvalidWalletSignatureError);
  });

  it('rejects linking an address already claimed by a different user', async () => {
    const { challengeService, confirmWalletLink, walletAddressRepository } = setup();
    const address = 'GABC...';
    await walletAddressRepository.create({
      userId: randomUUID(),
      address,
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const userId = randomUUID();
    const challenge = challengeService.issuedFor(userId, address, Date.now() + 60_000);

    await expect(
      confirmWalletLink({
        userId,
        address,
        challenge,
        signature: `valid-signature-for:${challenge}`,
      }),
    ).rejects.toThrow(WalletAlreadyLinkedError);
  });
});
