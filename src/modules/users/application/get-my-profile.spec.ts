import { describe, expect, it } from 'vitest';
import { createGetMyProfileUseCase } from './get-my-profile.js';
import { UserNotFoundError } from '../domain/index.js';
import {
  buildUser,
  createInMemoryUserReader,
  createInMemoryWalletAddressRepository,
} from './__fixtures__/fakes.js';

describe('getMyProfile', () => {
  it('returns the profile with an empty wallet list when none are linked', async () => {
    const userReader = createInMemoryUserReader();
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const user = buildUser({ email: 'user@example.com' });
    userReader.seed(user);

    const getMyProfile = createGetMyProfileUseCase({ userReader, walletAddressRepository });
    const result = await getMyProfile({ userId: user.id });

    expect(result.email).toBe('user@example.com');
    expect(result.wallets).toEqual([]);
  });

  it('includes linked wallets', async () => {
    const userReader = createInMemoryUserReader();
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const user = buildUser();
    userReader.seed(user);
    await walletAddressRepository.create({
      userId: user.id,
      address: 'GABC...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const getMyProfile = createGetMyProfileUseCase({ userReader, walletAddressRepository });
    const result = await getMyProfile({ userId: user.id });

    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0]).toMatchObject({ address: 'GABC...', isPrimary: true });
  });

  it('rejects an unknown user', async () => {
    const userReader = createInMemoryUserReader();
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const getMyProfile = createGetMyProfileUseCase({ userReader, walletAddressRepository });

    await expect(getMyProfile({ userId: 'missing' })).rejects.toThrow(UserNotFoundError);
  });
});
