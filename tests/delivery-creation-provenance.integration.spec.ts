import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { StrKey } from '@stellar/stellar-sdk';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createBlockedDeliveryCreationConsumer } from '../src/modules/deliveries/event-consumer.js';
import { createPrismaEventStore } from '../src/modules/indexer/infrastructure/prisma-event-store.js';
import { eventProcessingStatus } from '../src/modules/indexer/infrastructure/event-processing-status.js';
import { createAtomicDeliveryStatusConsumer } from '../src/modules/deliveries/event-consumer.js';
import { createPrismaDeliveryRepository } from '../src/modules/deliveries/infrastructure/prisma-delivery-repository.js';
import { buildChainDeliveryRecord } from '../src/modules/deliveries/application/__fixtures__/fakes.js';
import { testAddress } from '../src/shared/testing/addresses.js';

const schema = `creation_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
databaseUrl.searchParams.set('schema', schema);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const admin = new PrismaClient();
const network = `creation-${randomUUID()}`;
const contractId = StrKey.encodeContract(Buffer.alloc(32, 5));
const otherContract = StrKey.encodeContract(Buffer.alloc(32, 6));
const expected = { network, contractId };
const consume = createBlockedDeliveryCreationConsumer(prisma, expected);
let legacyId: string;
let sequence = 6000n;
async function admit(
  options: {
    payload?: unknown;
    observed?: string | null;
    actualNetwork?: string;
    ledger?: bigint;
  } = {},
) {
  const id = sequence++;
  const e = {
    contractName: 'delivery',
    network: options.actualNetwork ?? network,
    rpcEventId: randomUUID(),
    ledgerSeq: options.ledger ?? 42n,
    txHash: 'fixture',
    topic: ['delivery_created'],
    payload: options.payload ?? [id.toString(), testAddress('sender')],
    closedAt: new Date('2026-10-28'),
    ...(options.observed === null ? {} : { contractId: options.observed ?? contractId }),
  };
  await createPrismaEventStore(prisma).tryInsert(e);
  const raw = await prisma.blockchainEvent.findFirstOrThrow({
    where: { rpcEventId: e.rpcEventId },
  });
  return { id, e, eventId: raw.id };
}
async function reason(eventId: string) {
  const rows = await prisma.$queryRaw<
    Array<{ blocked_reason: string }>
  >`SELECT blocked_reason FROM event_consumer_obligations WHERE event_id = ${eventId} AND consumer_id = 'deliveries'`;
  return rows[0]?.blocked_reason;
}
async function noCreationEffects() {
  const completions = await prisma.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*)::bigint FROM event_consumer_completions`;
  const positions = await prisma.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*)::bigint FROM delivery_consumer_positions`;
  expect(completions[0]?.count).toBe(0n);
  expect(positions[0]?.count).toBe(0n);
  expect(
    await prisma.blockchainEvent.count({
      where: { processedAt: { not: null }, id: { not: legacyId } },
    }),
  ).toBe(0);
}
beforeAll(async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('Disposable test environment required');
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const initial = readFileSync('prisma/migrations/20260807104052_init/migration.sql', 'utf8');
  for (const pattern of [
    /CREATE TYPE "delivery_status"[^;]*;/,
    /CREATE TYPE "cargo_category"[^;]*;/,
    /CREATE TABLE "deliveries"[\s\S]*?;/,
    /CREATE TABLE "blockchain_events"[\s\S]*?;/,
    /CREATE UNIQUE INDEX "deliveries_chain_delivery_id_key"[^;]*;/,
    /CREATE UNIQUE INDEX "blockchain_events_contract_name_network_rpc_event_id_key"[^;]*;/,
  ]) {
    const sql = initial.match(pattern)?.[0];
    if (!sql) throw new Error('Historical fixture DDL missing');
    await prisma.$executeRawUnsafe(sql);
  }
  for (const file of [
    '20261028150000_event_processing_foundation',
    '20261028170000_delivery_consumer_completion',
  ]) {
    const sql = readFileSync(`prisma/migrations/${file}/migration.sql`, 'utf8');
    for (const statement of sql.split(';').filter((s) => s.trim()))
      await prisma.$executeRawUnsafe(statement);
  }
  const raw = await prisma.blockchainEvent.create({
    data: {
      contractName: 'delivery',
      network,
      rpcEventId: 'legacy',
      ledgerSeq: 1n,
      txHash: 'old',
      topic: ['delivery_created'],
      payload: ['1', testAddress('sender')],
      ledgerClosedAt: new Date('2026-01-01'),
      processedAt: new Date('2026-01-02'),
    },
  });
  legacyId = raw.id;
  const sql = readFileSync(
    'prisma/migrations/20261028190000_event_contract_observation/migration.sql',
    'utf8',
  );
  await prisma.$transaction(async (tx) => {
    for (const statement of sql.split(';').filter((s) => s.trim()))
      await tx.$executeRawUnsafe(statement);
  });
});
afterAll(async () => {
  await prisma.$disconnect();
  await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$disconnect();
});
describe('creation evidence guard: no authoritative historical source is installed', () => {
  it('retains observed identity atomically and durably blocks structurally valid legacy creation', async () => {
    const f = await admit();
    expect(
      await prisma.$queryRaw`SELECT contract_id FROM event_contract_observations WHERE event_id = ${f.eventId}`,
    ).toEqual([{ contract_id: contractId }]);
    expect(await consume(f.eventId)).toMatchObject({
      outcome: 'blocked',
      reason: 'delivery_creation_deployed_abi_and_historical_state_unverified',
    });
    expect(await reason(f.eventId)).toBe(
      'delivery_creation_deployed_abi_and_historical_state_unverified',
    );
    expect(await eventProcessingStatus(prisma, f.eventId)).toMatchObject({
      complete: false,
      obligations: [
        {
          consumer_id: 'deliveries',
          blocked_reason: 'delivery_creation_deployed_abi_and_historical_state_unverified',
        },
        { consumer_id: 'fraud-activity', blocked_reason: 'consumer_recovery_not_verified' },
      ],
    });
    await noCreationEffects();
  });
  it('rolls back admission if observation persistence fails, rather than retaining an unbound raw event', async () => {
    const before = await prisma.blockchainEvent.count();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION creation_test_observation_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture observation failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER creation_test_observation_fail AFTER INSERT ON event_contract_observations FOR EACH ROW EXECUTE FUNCTION creation_test_observation_fail()`,
    );
    try {
      await expect(admit()).rejects.toThrow('fixture observation failure');
      expect(await prisma.blockchainEvent.count()).toBe(before);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER creation_test_observation_fail ON event_contract_observations',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION creation_test_observation_fail()');
    }
    const f = await admit();
    expect(await consume(f.eventId)).toMatchObject({ outcome: 'blocked' });
  });
  it('recognizes the reference named event structurally without pretending the deployed ABI matches', async () => {
    const f = await admit({ payload: { delivery_id: '72', sender: testAddress('sender') } });
    expect(await consume(f.eventId)).toMatchObject({
      outcome: 'blocked',
      reason: 'delivery_creation_deployed_abi_and_historical_state_unverified',
    });
    await noCreationEffects();
  });
  it('persistently blocks missing/malformed data and invalid identifiers instead of inventing fields', async () => {
    for (const payload of [
      [],
      ['1'],
      ['1', 'invalid'],
      ['-1', testAddress('sender')],
      ['18446744073709551616', testAddress('sender')],
      [9007199254740992, testAddress('sender')],
      { sender: testAddress('sender') },
    ]) {
      const f = await admit({ payload });
      expect(await consume(f.eventId)).toMatchObject({
        outcome: 'blocked',
        reason: 'delivery_creation_payload_or_ledger_invalid',
      });
      expect(await reason(f.eventId)).toBe('delivery_creation_payload_or_ledger_invalid');
    }
    const f = await admit({ ledger: 0n });
    expect(await consume(f.eventId)).toMatchObject({
      reason: 'delivery_creation_payload_or_ledger_invalid',
    });
    await noCreationEffects();
  });
  it('distinguishes missing origin, wrong contract and wrong network', async () => {
    for (const [options, blocked] of [
      [{ observed: null }, 'delivery_creation_contract_provenance_missing'],
      [{ observed: otherContract }, 'delivery_creation_contract_mismatch'],
      [{ actualNetwork: 'another-network' }, 'delivery_creation_network_mismatch'],
    ] satisfies Array<[{ observed?: string | null; actualNetwork?: string }, string]>) {
      const f = await admit(options);
      expect(await consume(f.eventId)).toMatchObject({ outcome: 'blocked', reason: blocked });
      expect(await reason(f.eventId)).toBe(blocked);
    }
    await noCreationEffects();
  });
  it('does not backfill historical identity or mark historical completion through duplicate receipt', async () => {
    expect(
      await createPrismaEventStore(prisma).tryInsert({
        contractName: 'delivery',
        network,
        contractId,
        rpcEventId: 'legacy',
        ledgerSeq: 1n,
        txHash: 'old',
        topic: ['delivery_created'],
        payload: ['1', testAddress('sender')],
        closedAt: new Date('2026-01-01'),
      }),
    ).toBe(false);
    expect(
      await prisma.$queryRaw`SELECT * FROM event_contract_observations WHERE event_id = ${legacyId}`,
    ).toEqual([]);
    await expect(consume(legacyId)).rejects.toThrow('historical completion stays unknown');
    expect(await eventProcessingStatus(prisma, legacyId)).toEqual({
      status: 'historical_unknown',
      complete: false,
    });
  });
  it('rejects contradictory duplicate origins and preserves the original observation', async () => {
    const f = await admit();
    await expect(
      createPrismaEventStore(prisma).tryInsert({ ...f.e, contractId: otherContract }),
    ).rejects.toThrow('Conflicting contract identity');
    expect(
      await prisma.$queryRaw`SELECT contract_id FROM event_contract_observations WHERE event_id = ${f.eventId}`,
    ).toEqual([{ contract_id: contractId }]);
  });
  it('concurrent/duplicate attempts persist one block transition and a restarted client sees it', async () => {
    const f = await admit();
    await prisma.$executeRawUnsafe('CREATE TABLE creation_test_audit (event_id TEXT)');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION creation_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO creation_test_audit VALUES (NEW.event_id); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER creation_test_audit AFTER UPDATE ON event_consumer_obligations FOR EACH ROW EXECUTE FUNCTION creation_test_audit()`,
    );
    try {
      const results = await Promise.all(Array.from({ length: 6 }, () => consume(f.eventId)));
      expect(results.every((v) => v.outcome === 'blocked')).toBe(true);
      expect(await prisma.$queryRaw`SELECT event_id FROM creation_test_audit`).toEqual([
        { event_id: f.eventId },
      ]);
      expect(await createPrismaEventStore(prisma).tryInsert(f.e)).toBe(false);
      const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
      try {
        expect(
          await createBlockedDeliveryCreationConsumer(restarted, expected)(f.eventId),
        ).toMatchObject({ outcome: 'blocked' });
      } finally {
        await restarted.$disconnect();
      }
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER creation_test_audit ON event_consumer_obligations',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION creation_test_audit()');
      await prisma.$executeRawUnsafe('DROP TABLE creation_test_audit');
    }
    await noCreationEffects();
  });
  it('rolls back a failed durable-reason write and safely records it on retry', async () => {
    const f = await admit();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION creation_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture block failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER creation_test_fail AFTER UPDATE ON event_consumer_obligations FOR EACH ROW EXECUTE FUNCTION creation_test_fail()`,
    );
    try {
      await expect(consume(f.eventId)).rejects.toThrow('fixture block failure');
      expect(await reason(f.eventId)).toBe('consumer_recovery_not_verified');
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER creation_test_fail ON event_consumer_obligations',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION creation_test_fail()');
    }
    expect(await consume(f.eventId)).toMatchObject({ outcome: 'blocked' });
  });
  it('refuses current mutable state and preserves a conflicting newer projection', async () => {
    const f = await admit();
    const current = buildChainDeliveryRecord({
      chainDeliveryId: f.id,
      status: 'DELIVERED',
      origin: 'changed-after-creation',
    });
    await createPrismaDeliveryRepository(prisma).create(current);
    expect(await consume(f.eventId)).toMatchObject({
      reason: 'delivery_creation_deployed_abi_and_historical_state_unverified',
    });
    expect(await prisma.delivery.findUnique({ where: { chainDeliveryId: f.id } })).toMatchObject({
      status: 'DELIVERED',
      origin: 'changed-after-creation',
    });
    // No fabricated provenance means later status processing also stays blocked.
    const later = {
      ...f.e,
      rpcEventId: randomUUID(),
      ledgerSeq: 43n,
      topic: ['delivery_confirmed'],
    };
    await createPrismaEventStore(prisma).tryInsert(later);
    const event = await prisma.blockchainEvent.findFirstOrThrow({
      where: { rpcEventId: later.rpcEventId },
    });
    await expect(createAtomicDeliveryStatusConsumer(prisma)(event.id)).rejects.toThrow(
      'ordering provenance unavailable',
    );
    await noCreationEffects();
  });
  it('a killed process leaves the reason update uncommitted; retry durably blocks without effects', async () => {
    const f = await admit();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION creation_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER creation_test_pause AFTER UPDATE ON event_consumer_obligations FOR EACH ROW EXECUTE FUNCTION creation_test_pause()`,
    );
    const child = fork(
      fileURLToPath(new URL('./__fixtures__/creation-guard-worker.ts', import.meta.url)),
      [f.eventId, network, contractId],
      {
        execArgv: [
          '--import',
          fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
        ],
        env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    try {
      let killed = false;
      for (let i = 0; i < 150; i++) {
        const rows = await prisma.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep' AND pid <> pg_backend_pid()`;
        if (rows.length) {
          child.kill('SIGKILL');
          await exited;
          killed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(killed).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER creation_test_pause ON event_consumer_obligations',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION creation_test_pause()');
    }
    expect(await reason(f.eventId)).toBe('consumer_recovery_not_verified');
    expect(await consume(f.eventId)).toMatchObject({ outcome: 'blocked' });
    await noCreationEffects();
  });
});
