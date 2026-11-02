import { Account, Address, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createBuildEscrowTransactionsUseCases } from '../src/modules/escrow/application/build-escrow-transactions.js';
import { createFakeEscrowTransactionBuilder } from '../src/modules/escrow/application/__fixtures__/fakes.js';
import {
  assertEscrowDeliveryId,
  ESCROW_DELIVERY_ID_MAX,
} from '../src/modules/escrow/domain/identifiers.js';
import { createSorobanEscrowContractClient } from '../src/modules/escrow/infrastructure/soroban-escrow-contract-client.js';
import { SorobanClient } from '../src/blockchain/soroban-client.js';
import { getConfig } from '../src/shared/config/index.js';
import { ValidationError, handleError } from '../src/shared/errors/index.js';
import { testAddress } from '../src/shared/testing/addresses.js';
import { createEscrowRoutes } from '../src/modules/escrow/interface/routes.js';
import { createGetEscrowUseCase } from '../src/modules/escrow/application/get-escrow.js';
import { createPrismaEscrowRepository } from '../src/modules/escrow/infrastructure/prisma-escrow-repository.js';
import { createEscrowArgsToScVal } from '../src/modules/escrow/infrastructure/escrow-scval-mapping.js';
import { disconnectPrisma } from '../src/shared/database/index.js';
import { signAccessToken } from '../src/shared/jwt/index.js';

const sender = testAddress('escrow-id-sender');
const recipient = testAddress('escrow-id-recipient');
const driver = testAddress('escrow-id-driver');
const token = Address.contract(Buffer.alloc(32, 7)).toString();
const contractId = Address.contract(Buffer.alloc(32, 8)).toString();
const amount = (1n << 100n) + 23n;
const validIds = [
  0n,
  1n,
  9007199254740991n,
  9007199254740993n,
  (1n << 63n) - 1n,
  1n << 63n,
  ESCROW_DELIVERY_ID_MAX,
];

function controlledAdapter() {
  const client = new SorobanClient('http://127.0.0.1:9');
  const account = vi
    .spyOn(client, 'getAccount')
    .mockImplementation(async (address) => new Account(address, '100'));
  const prepare = vi.spyOn(client, 'prepareTransaction').mockImplementation(async (transaction) => {
    if (!(transaction instanceof Transaction))
      throw new Error('Expected ordinary unsigned transaction');
    return transaction;
  });
  const balance = vi.fn(async () => null);
  const adapter = createSorobanEscrowContractClient(client, contractId, {
    getTokenBalance: balance,
  });
  return { adapter, account, prepare, balance };
}

function decodeInvocation(encoded: string) {
  const transaction = TransactionBuilder.fromXDR(encoded, getConfig().STELLAR_NETWORK_PASSPHRASE);
  if (!(transaction instanceof Transaction)) throw new Error('Expected ordinary transaction');
  const operation = transaction.operations[0];
  if (operation?.type !== 'invokeHostFunction') throw new Error('Expected contract invocation');
  return { transaction, invocation: operation.func.invokeContract() };
}

describe('escrow delivery identifier representation', () => {
  it.each([-1n, 1n << 64n])('rejects out-of-range standalone create mapper input %s', (id) => {
    expect(() =>
      createEscrowArgsToScVal({
        senderAddress: sender,
        recipientAddress: recipient,
        driverAddress: driver,
        token,
        amount,
        chainDeliveryId: id,
      }),
    ).toThrow(ValidationError);
  });
  it.each(validIds)('uses the exact bigint in the optional refund-status port: %s', async (id) => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const getEscrowStatus = vi.fn(async (_id: bigint) => 'LOCKED' as const);
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder, getEscrowStatus });
    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: sender, chainDeliveryId: id }),
    ).resolves.toBe('unsigned-xdr:refund-escrow');
    expect(getEscrowStatus).toHaveBeenCalledExactlyOnceWith(id);
    expect(typeof getEscrowStatus.mock.calls[0]?.[0]).toBe('bigint');
  });

  it.each([-1n, 1n << 64n])('rejects %s before optional lookup or builder calls', async (id) => {
    const transactionBuilder = createFakeEscrowTransactionBuilder();
    const create = vi.spyOn(transactionBuilder, 'buildCreateEscrow');
    const release = vi.spyOn(transactionBuilder, 'buildReleaseEscrow');
    const refund = vi.spyOn(transactionBuilder, 'buildRefundEscrow');
    const getEscrowStatus = vi.fn(async (_id: bigint) => 'LOCKED' as const);
    const useCases = createBuildEscrowTransactionsUseCases({ transactionBuilder, getEscrowStatus });
    await expect(
      useCases.buildCreateEscrowTransaction({
        senderAddress: sender,
        recipientAddress: recipient,
        driverAddress: driver,
        token,
        amount,
        chainDeliveryId: id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCases.buildReleaseEscrowTransaction({ callerAddress: recipient, chainDeliveryId: id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCases.buildRefundEscrowTransaction({ callerAddress: sender, chainDeliveryId: id }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(getEscrowStatus).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 1, Number.MAX_SAFE_INTEGER + 1, '1', 'user-uuid', true, {}])(
    'rejects a non-bigint internal representation: %j',
    (id) => {
      expect(() => assertEscrowDeliveryId(id)).toThrow(ValidationError);
    },
  );
});

describe.each(['create', 'release', 'refund'] as const)('%s escrow exact unsigned XDR', (kind) => {
  it.each(validIds)(
    'encodes delivery key %s as bare u64 with unchanged arguments and source',
    async (id) => {
      const { adapter, account, prepare } = controlledAdapter();
      const encoded =
        kind === 'create'
          ? await adapter.buildCreateEscrow({
              senderAddress: sender,
              recipientAddress: recipient,
              driverAddress: driver,
              token,
              amount,
              chainDeliveryId: id,
            })
          : kind === 'release'
            ? await adapter.buildReleaseEscrow({ callerAddress: recipient, chainDeliveryId: id })
            : await adapter.buildRefundEscrow({ callerAddress: sender, chainDeliveryId: id });
      const { transaction, invocation } = decodeInvocation(encoded);
      expect(invocation.functionName().toString()).toBe(`${kind}_escrow`);
      expect(Address.fromScAddress(invocation.contractAddress()).toString()).toBe(contractId);
      expect(transaction.source).toBe(kind === 'release' ? recipient : sender);
      expect(account).toHaveBeenCalledWith(transaction.source);
      expect(transaction.signatures).toHaveLength(0);
      expect(prepare).toHaveBeenCalledTimes(1);
      const args = invocation.args();
      expect(args).toHaveLength(kind === 'create' ? 6 : 2);
      const key = args[kind === 'create' ? 3 : 1];
      expect(key?.switch().name).toBe('scvU64');
      expect(key?.u64().toString()).toBe(id.toString());
      if (kind === 'create') {
        expect(args.slice(0, 3).map((arg) => Address.fromScVal(arg).toString())).toEqual([
          sender,
          recipient,
          driver,
        ]);
        expect(Address.fromScVal(args[4]!).toString()).toBe(token);
        const parts = args[5]!.i128();
        expect(BigInt(parts.hi().toString()) * (1n << 64n) + BigInt(parts.lo().toString())).toBe(
          amount,
        );
      } else
        expect(Address.fromScVal(args[0]!).toString()).toBe(
          kind === 'release' ? recipient : sender,
        );
    },
  );

  it.each([-1n, 1n << 64n])(
    'rejects out-of-range direct adapter ID %s before balance/account/preparation',
    async (id) => {
      const { adapter, account, prepare, balance } = controlledAdapter();
      const pending =
        kind === 'create'
          ? adapter.buildCreateEscrow({
              senderAddress: sender,
              recipientAddress: recipient,
              driverAddress: driver,
              token,
              amount,
              chainDeliveryId: id,
            })
          : kind === 'release'
            ? adapter.buildReleaseEscrow({ callerAddress: recipient, chainDeliveryId: id })
            : adapter.buildRefundEscrow({ callerAddress: sender, chainDeliveryId: id });
      await expect(pending).rejects.toBeInstanceOf(ValidationError);
      expect(balance).not.toHaveBeenCalled();
      expect(account).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    },
  );
});

describe('authenticated escrow builder HTTP identifier boundaries', () => {
  const prisma = new PrismaClient();
  const app = Fastify();
  const fixture = controlledAdapter();
  const getEscrowStatus = vi.fn(async (_id: bigint) => 'LOCKED' as const);
  let userId: string;
  let accessToken: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@escrow-id.invalid`, passwordHash: 'fixture-only' },
    });
    userId = user.id;
    accessToken = signAccessToken({ sub: userId, role: 'CUSTOMER', tokenVersion: 0 });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(handleError);
    await app.register(
      createEscrowRoutes({
        getEscrow: createGetEscrowUseCase({
          escrowRepository: createPrismaEscrowRepository(prisma),
        }),
        buildTransactions: createBuildEscrowTransactionsUseCases({
          transactionBuilder: fixture.adapter,
          getEscrowStatus,
        }),
      }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  it('keeps local UUIDs distinct from exact signed-bigint database delivery keys', async () => {
    const id = (1n << 63n) - 1n;
    try {
      const delivery = await prisma.delivery.create({
        data: {
          chainDeliveryId: id,
          senderAddress: sender,
          recipientAddress: recipient,
          status: 'PENDING',
          origin: 'A',
          destination: 'B',
          cargoCategory: 'GENERAL',
          weightGrams: 500,
          fragile: false,
          createdAtChain: new Date('2026-01-01T00:00:00Z'),
        },
      });
      const escrow = await prisma.escrow.create({
        data: {
          chainDeliveryId: id,
          senderAddress: sender,
          recipientAddress: recipient,
          driverAddress: driver,
          token,
          amount: amount.toString(),
          status: 'LOCKED',
          createdAtChain: new Date('2026-01-01T00:00:00Z'),
        },
      });
      expect(delivery.id).not.toBe(escrow.id);
      expect(escrow.id).not.toBe(id.toString());
      expect(escrow.chainDeliveryId).toBe(id);
      expect((await prisma.escrow.findUniqueOrThrow({ where: { chainDeliveryId: id } })).id).toBe(
        escrow.id,
      );
      expect(escrow.amount.toFixed(0)).toBe(amount.toString());
      expect(() => assertEscrowDeliveryId(escrow.id)).toThrow(ValidationError);
    } finally {
      await prisma.escrow.deleteMany({ where: { chainDeliveryId: id } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: id } });
    }
  });

  describe.each(['create', 'release', 'refund'] as const)('%s HTTP input', (kind) => {
    const body = (chainDeliveryId: unknown) =>
      kind === 'create'
        ? {
            senderAddress: sender,
            recipientAddress: recipient,
            driverAddress: driver,
            token,
            amount: amount.toString(),
            chainDeliveryId,
          }
        : { callerAddress: kind === 'release' ? recipient : sender, chainDeliveryId };
    const url = `/transactions/build/${kind}-escrow`;
    const invalidIds = [
      '-1',
      '+1',
      '1.5',
      '1e3',
      ' 1',
      '1 ',
      '',
      'nope',
      contractId,
      '00000000-0000-4000-8000-000000000001',
      null,
      1,
      true,
      {},
      (1n << 64n).toString(),
      '9'.repeat(128),
    ];

    it('requires authentication before validating/building', async () => {
      fixture.account.mockClear();
      expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(401);
      expect(fixture.account).not.toHaveBeenCalled();
    });

    it.each(invalidIds)(
      'rejects malformed/out-of-u64 identifier %j before dependencies',
      async (id) => {
        fixture.account.mockClear();
        fixture.prepare.mockClear();
        fixture.balance.mockClear();
        getEscrowStatus.mockClear();
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: body(id),
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
        expect(fixture.account).not.toHaveBeenCalled();
        expect(fixture.prepare).not.toHaveBeenCalled();
        expect(fixture.balance).not.toHaveBeenCalled();
        expect(getEscrowStatus).not.toHaveBeenCalled();
      },
    );

    it.each(['0', '0001', '9007199254740993', ESCROW_DELIVERY_ID_MAX.toString()])(
      'retains digit-string API and exact bigint encoding of %s',
      async (id) => {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: { authorization: `Bearer ${accessToken}` },
          payload: body(id),
        });
        expect(response.statusCode).toBe(200);
        const { transaction, invocation } = decodeInvocation(response.json().data.xdr);
        const key = invocation.args()[kind === 'create' ? 3 : 1];
        expect(key?.switch().name).toBe('scvU64');
        expect(key?.u64().toString()).toBe(BigInt(id).toString());
        expect(transaction.signatures).toHaveLength(0);
        if (kind === 'refund') expect(getEscrowStatus).toHaveBeenLastCalledWith(BigInt(id));
      },
    );
  });
});
