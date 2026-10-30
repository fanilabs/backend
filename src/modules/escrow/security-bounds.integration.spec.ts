import { randomBytes, randomUUID } from 'node:crypto';
import { Account, Address, Keypair, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createBuildEscrowTransactionsUseCases } from './application/build-escrow-transactions.js';
import { createSorobanEscrowContractClient } from './infrastructure/soroban-escrow-contract-client.js';
import { createEscrowArgsToScVal } from './infrastructure/escrow-scval-mapping.js';
import { createEscrowRoutes } from './interface/routes.js';
import { SorobanClient } from '../../blockchain/soroban-client.js';
import { scValToNative } from '../../blockchain/xdr/sc-val.js';
import { I128_MAX } from '../../shared/validation/i128.js';
import { handleError } from '../../shared/errors/error-handler.js';
import { signAccessToken } from '../../shared/jwt/index.js';
import { disconnectPrisma } from '../../shared/database/index.js';

// Use the real route dependencies without loading unrelated metrics/worker barrels.
vi.mock('../../shared/http/index.js', async () => ({
  ...(await import('../../shared/http/plugins/auth-guard.js')),
  ...(await import('../../shared/http/response-envelope.js')),
}));
const prisma = new PrismaClient();
const createdUserIds: string[] = [];
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await disconnectPrisma();
});
const sender = Keypair.random().publicKey();
const input = {
  senderAddress: sender,
  recipientAddress: Keypair.random().publicKey(),
  driverAddress: Keypair.random().publicKey(),
  chainDeliveryId: 1n,
  token: Address.contract(randomBytes(32)).toString(),
  amount: I128_MAX,
};

function builder() {
  const client = new SorobanClient('http://127.0.0.1:9');
  const balance = vi.fn(async () => null);
  const account = vi.spyOn(client, 'getAccount').mockResolvedValue(new Account(sender, '100'));
  vi.spyOn(client, 'prepareTransaction').mockImplementation(async (transaction) => {
    if (!(transaction instanceof Transaction)) throw new Error('Expected ordinary transaction');
    return transaction;
  });
  return {
    client,
    account,
    balance,
    adapter: createSorobanEscrowContractClient(
      client,
      Address.contract(randomBytes(32)).toString(),
      { getTokenBalance: balance },
    ),
  };
}

describe('escrow amount bounds at callers', () => {
  it('rejects an oversized direct builder input before balance/account RPC', async () => {
    const { adapter, account, balance } = builder();
    await expect(
      adapter.buildCreateEscrow({ ...input, amount: I128_MAX + 1n }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(balance).not.toHaveBeenCalled();
    expect(account).not.toHaveBeenCalled();
    expect(() => createEscrowArgsToScVal({ ...input, amount: I128_MAX + 1n })).toThrow(
      'signed 128-bit bounds',
    );
  });

  it('rejects overflow at the application port before delegation', async () => {
    const { adapter, balance, account } = builder();
    const build = createBuildEscrowTransactionsUseCases({ transactionBuilder: adapter });
    await expect(
      build.buildCreateEscrowTransaction({ ...input, amount: I128_MAX + 1n }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(balance).not.toHaveBeenCalled();
    expect(account).not.toHaveBeenCalled();
  });

  it.each([0n, -1n])('preserves strictly positive escrow amount rules for %s', async (amount) => {
    const { adapter, balance } = builder();
    await expect(adapter.buildCreateEscrow({ ...input, amount })).rejects.toThrow(
      'greater than zero',
    );
    expect(balance).not.toHaveBeenCalled();
  });

  it.each([1n, 10000000n, I128_MAX])(
    'returns unsigned bytes encoding exactly %s',
    async (amount) => {
      const { adapter } = builder();
      const encoded = await adapter.buildCreateEscrow({ ...input, amount });
      const tx = TransactionBuilder.fromXDR(encoded, 'Test SDF Network ; September 2015');
      const operation = tx.operations[0];
      if (!operation || operation.type !== 'invokeHostFunction')
        throw new Error('Expected invocation');
      expect(scValToNative(operation.func.invokeContract().args()[5]!)).toBe(amount.toString());
      expect(tx.signatures).toHaveLength(0);
    },
  );

  it('returns HTTP 400 for overflow through the real authenticated escrow route', async () => {
    const { adapter, balance } = builder();
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(handleError);
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@amount.invalid`, passwordHash: 'test' },
    });
    createdUserIds.push(user.id);
    await app.register(
      createEscrowRoutes({
        getEscrow: async () => {
          throw new Error('unused');
        },
        buildTransactions: createBuildEscrowTransactionsUseCases({ transactionBuilder: adapter }),
      }),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/transactions/build/create-escrow',
        headers: {
          authorization: `Bearer ${signAccessToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion })}`,
        },
        payload: { ...input, chainDeliveryId: '1', amount: (I128_MAX + 1n).toString() },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      expect(balance).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
