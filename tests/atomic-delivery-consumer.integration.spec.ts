import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createAtomicDeliveryStatusConsumer } from '../src/modules/deliveries/event-consumer.js';
import { createPrismaDeliveryRepository } from '../src/modules/deliveries/infrastructure/prisma-delivery-repository.js';
import { buildChainDeliveryRecord } from '../src/modules/deliveries/application/__fixtures__/fakes.js';
import { createPrismaEventStore } from '../src/modules/indexer/infrastructure/prisma-event-store.js';
import { eventProcessingStatus } from '../src/modules/indexer/infrastructure/event-processing-status.js';
import { testAddress } from '../src/shared/testing/addresses.js';

// Each run owns an isolated schema in a disposable PostgreSQL service.
// Actual migration, repository, transactions and database faults; no DB mocks.
const schema = `delivery_atomic_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
databaseUrl.searchParams.set('schema', schema);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const admin = new PrismaClient();
const network = `delivery-atomic-${randomUUID()}`;
const chainIds: bigint[] = [];
const consume = createAtomicDeliveryStatusConsumer(prisma);
const repository = createPrismaDeliveryRepository(prisma);
let sequence = BigInt(Date.now()) * 1000n;
let legacyEventId: string;
let legacyProjectionId: bigint;
async function projection(withPosition = true) {
  const id = sequence++;
  chainIds.push(id);
  await repository.create(buildChainDeliveryRecord({ chainDeliveryId: id, status: 'PENDING' }));
  // Explicit known fixture provenance, not adoption of historical production data.
  // Real initialization remains gated on pinned creation/reconciliation evidence.
  if (withPosition)
    await prisma.$executeRaw`
    INSERT INTO delivery_consumer_positions (chain_delivery_id, network, last_ledger_seq) VALUES (${id}, ${network}, 1)`;
  return id;
}
async function admit(
  id: bigint,
  topic: string,
  ledgerSeq = 2n,
  idValue: string | number = id.toString(),
) {
  const e = {
    contractName: 'delivery',
    network,
    rpcEventId: randomUUID(),
    ledgerSeq,
    txHash: 'fixture',
    topic: [topic],
    payload: [idValue, testAddress('driver')],
    closedAt: new Date(`2026-10-${String(Number(ledgerSeq) + 1).padStart(2, '0')}T00:00:00Z`),
  };
  await createPrismaEventStore(prisma).tryInsert(e);
  return (
    await prisma.blockchainEvent.findFirstOrThrow({ where: { network, rpcEventId: e.rpcEventId } })
  ).id;
}
async function completions(eventId: string) {
  return prisma.$queryRaw<
    Array<{ consumer_id: string }>
  >`SELECT consumer_id FROM event_consumer_completions WHERE event_id = ${eventId}`;
}
async function position(id: bigint) {
  return prisma.$queryRaw<
    Array<{ last_ledger_seq: bigint }>
  >`SELECT last_ledger_seq FROM delivery_consumer_positions WHERE chain_delivery_id = ${id}`;
}
async function updateCount(id: bigint) {
  const rows = await prisma.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*)::bigint FROM delivery_atomic_test_audit WHERE chain_delivery_id = ${id}`;
  return rows[0]?.count;
}
beforeAll(async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('Disposable test environment required');
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const initial = readFileSync('prisma/migrations/20260807104052_init/migration.sql', 'utf8');
  const statements = [
    /CREATE TYPE "delivery_status"[^;]*;/,
    /CREATE TYPE "cargo_category"[^;]*;/,
    /CREATE TABLE "deliveries"[\s\S]*?;/,
    /CREATE TABLE "blockchain_events"[\s\S]*?;/,
    /CREATE TABLE "blockchain_checkpoints"[\s\S]*?;/,
    /CREATE UNIQUE INDEX "deliveries_chain_delivery_id_key"[^;]*;/,
    /CREATE UNIQUE INDEX "blockchain_events_contract_name_network_rpc_event_id_key"[^;]*;/,
  ];
  for (const pattern of statements) {
    const statement = initial.match(pattern)?.[0];
    if (!statement) throw new Error('Historical schema component missing');
    await prisma.$executeRawUnsafe(statement);
  }
  const foundation = readFileSync(
    'prisma/migrations/20261028150000_event_processing_foundation/migration.sql',
    'utf8',
  );
  for (const statement of foundation.split(';').filter((s) => s.trim()))
    await prisma.$executeRawUnsafe(statement);
  legacyProjectionId = sequence++;
  await repository.create(
    buildChainDeliveryRecord({ chainDeliveryId: legacyProjectionId, status: 'DELIVERED' }),
  );
  const old = await prisma.blockchainEvent.create({
    data: {
      contractName: 'delivery',
      network,
      rpcEventId: 'legacy',
      ledgerSeq: 1n,
      txHash: 'legacy',
      topic: ['delivery_created'],
      payload: ['1'],
      ledgerClosedAt: new Date('2026-01-01'),
      processedAt: new Date('2026-01-02'),
    },
  });
  legacyEventId = old.id;
  const sql = readFileSync(
    'prisma/migrations/20261028170000_delivery_consumer_completion/migration.sql',
    'utf8',
  );
  await prisma.$transaction(async (tx) => {
    for (const statement of sql.split(';').filter((s) => s.trim()))
      await tx.$executeRawUnsafe(statement);
  });
  await prisma.$executeRawUnsafe(
    'CREATE TABLE delivery_atomic_test_audit (chain_delivery_id BIGINT NOT NULL)',
  );
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION delivery_atomic_test_audit_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO delivery_atomic_test_audit VALUES (NEW.chain_delivery_id); RETURN NEW; END $$`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER delivery_atomic_test_audit AFTER UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION delivery_atomic_test_audit_write()`,
  );
});
afterAll(async () => {
  await prisma.$disconnect();
  await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.$disconnect();
});
describe('atomic deliveries status consumer (production remains gated)', () => {
  it('preserves historical completion as unknown through the additive migration', async () => {
    await expect(consume(legacyEventId)).rejects.toThrow('historical completion stays unknown');
    expect(await completions(legacyEventId)).toEqual([]);
    expect(await position(legacyProjectionId)).toEqual([]);
    expect((await repository.findByChainId(legacyProjectionId))?.status).toBe('DELIVERED');
    expect(await eventProcessingStatus(prisma, legacyEventId)).toEqual({
      status: 'historical_unknown',
      complete: false,
    });
    expect(
      (await prisma.blockchainEvent.findUniqueOrThrow({ where: { id: legacyEventId } }))
        .processedAt,
    ).toEqual(new Date('2026-01-02'));
  });
  it('commits actual repository effects, ordering and just deliveries completion together', async () => {
    const id = await projection();
    const eventId = await admit(id, 'driver_assigned');
    expect(await consume(eventId)).toBe('completed');
    expect(await repository.findByChainId(id)).toMatchObject({
      status: 'ACTIVE',
      driverAddress: testAddress('driver'),
    });
    expect(await completions(eventId)).toEqual([{ consumer_id: 'deliveries' }]);
    expect(await position(id)).toEqual([{ last_ledger_seq: 2n }]);
    expect(
      (await prisma.blockchainEvent.findUniqueOrThrow({ where: { id: eventId } })).processedAt,
    ).toBeNull();
    expect(await eventProcessingStatus(prisma, eventId)).toMatchObject({
      complete: false,
      status: 'blocked',
    });
    expect(await prisma.blockchainCheckpoint.count({ where: { network } })).toBe(0);
  });
  it('rolls back handler database failure, then retries the entire transaction', async () => {
    const id = await projection();
    const eventId = await admit(id, 'driver_assigned');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION delivery_atomic_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture handler failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER delivery_atomic_fail_write AFTER UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION delivery_atomic_fail_write()`,
    );
    try {
      await expect(consume(eventId)).rejects.toThrow('fixture handler failure');
      expect((await repository.findByChainId(id))?.status).toBe('PENDING');
      expect(await completions(eventId)).toEqual([]);
      expect(await position(id)).toEqual([{ last_ledger_seq: 1n }]);
      expect(await updateCount(id)).toBe(0n);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER delivery_atomic_fail_write ON deliveries');
      await prisma.$executeRawUnsafe('DROP FUNCTION delivery_atomic_fail_write()');
    }
    expect(await consume(eventId)).toBe('completed');
    expect(await updateCount(id)).toBe(1n);
  });
  it('rolls back successful effect and cursor writes if completion insert fails', async () => {
    const id = await projection();
    const eventId = await admit(id, 'driver_assigned');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION delivery_atomic_fail_complete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture completion failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER delivery_atomic_fail_complete BEFORE INSERT ON event_consumer_completions FOR EACH ROW EXECUTE FUNCTION delivery_atomic_fail_complete()`,
    );
    try {
      await expect(consume(eventId)).rejects.toThrow('fixture completion failure');
      expect((await repository.findByChainId(id))?.status).toBe('PENDING');
      expect(await completions(eventId)).toEqual([]);
      expect(await position(id)).toEqual([{ last_ledger_seq: 1n }]);
      expect(await updateCount(id)).toBe(0n);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER delivery_atomic_fail_complete ON event_consumer_completions',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION delivery_atomic_fail_complete()');
    }
    expect(await consume(eventId)).toBe('completed');
  });
  it('concurrent attempts and retries after a committed success perform one update', async () => {
    const id = await projection();
    const eventId = await admit(id, 'driver_assigned');
    const result = await Promise.all(Array.from({ length: 6 }, () => consume(eventId)));
    expect(result.filter((v) => v === 'completed')).toHaveLength(1);
    expect(result.filter((v) => v === 'already_completed')).toHaveLength(5);
    const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
    try {
      expect(await createAtomicDeliveryStatusConsumer(restarted)(eventId)).toBe(
        'already_completed',
      );
    } finally {
      await restarted.$disconnect();
    }
    expect(await updateCount(id)).toBe(1n);
    expect(await completions(eventId)).toHaveLength(1);
  });
  it('honors known earlier pending events, including supported alternate ID encodings', async () => {
    const id = await projection();
    const assigned = await admit(id, 'driver_assigned', 2n, `0${id}`);
    const transit = await admit(id, 'DeliveryInTransit', 3n);
    await expect(consume(transit)).rejects.toThrow('Earlier or same-ledger');
    expect(await completions(transit)).toEqual([]);
    await consume(assigned);
    await consume(transit);
    expect(await repository.findByChainId(id)).toMatchObject({
      status: 'IN_TRANSIT',
      driverAddress: testAddress('driver'),
      transitStartedAt: new Date('2026-10-04'),
    });
  });
  it('rejects a late stale event without changing newer state or acknowledging it', async () => {
    const id = await projection();
    const confirmed = await admit(id, 'delivery_confirmed', 4n);
    await consume(confirmed);
    const assigned = await admit(id, 'driver_assigned', 2n);
    await expect(consume(assigned)).rejects.toThrow('Stale or same-ledger');
    expect(await repository.findByChainId(id)).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: new Date('2026-10-05'),
    });
    expect(await completions(assigned)).toEqual([]);
    expect(await updateCount(id)).toBe(1n);
  });
  it('does not guess order between distinct same-ledger events or sort RPC IDs', async () => {
    const id = await projection();
    const first = await admit(id, 'driver_assigned', 2n);
    const second = await admit(id, 'DeliveryInTransit', 2n);
    await expect(consume(first)).rejects.toThrow('Earlier or same-ledger');
    await expect(consume(second)).rejects.toThrow('Earlier or same-ledger');
    expect(await updateCount(id)).toBe(0n);
    expect(await completions(first)).toEqual([]);
    expect(await completions(second)).toEqual([]);
  });
  it('serializes related concurrent events without losing assignment fields', async () => {
    const id = await projection();
    const assigned = await admit(id, 'driver_assigned', 2n);
    const transit = await admit(id, 'DeliveryInTransit', 3n);
    const results = await Promise.allSettled([consume(transit), consume(assigned)]);
    expect(results[1]?.status).toBe('fulfilled');
    if (results[0]?.status === 'rejected')
      expect(String(results[0].reason)).toContain('Earlier or same-ledger');
    await consume(transit);
    expect(await repository.findByChainId(id)).toMatchObject({
      status: 'IN_TRANSIT',
      driverAddress: testAddress('driver'),
    });
    expect(await updateCount(id)).toBe(2n);
  });
  it('preserves cancellation and dispute patches, with per-aggregate rather than global order', async () => {
    const a = await projection();
    const b = await projection();
    const cancel = await admit(a, 'delivery_cancelled', 5n);
    const dispute = await admit(b, 'delivery_disputed', 2n);
    await consume(cancel);
    await consume(dispute);
    expect((await repository.findByChainId(a))?.status).toBe('CANCELLED');
    expect((await repository.findByChainId(b))?.status).toBe('DISPUTED');
  });
  it('blocks missing projections/provenance, cross-network writes and event-time creation hydration', async () => {
    const id = await projection(false);
    const e = await admit(id, 'driver_assigned');
    await expect(consume(e)).rejects.toThrow('ordering provenance unavailable');
    const create = await admit(id, 'delivery_created');
    await expect(consume(create)).rejects.toThrow('event-time hydration snapshot');
    expect(await completions(e)).toEqual([]);
    expect(await completions(create)).toEqual([]);
    const missing = await admit(sequence++, 'driver_assigned');
    await expect(consume(missing)).rejects.toThrow('Delivery not found');
    await prisma.$executeRaw`INSERT INTO delivery_consumer_positions VALUES (${id}, 'another-network', 1)`;
    await expect(consume(e)).rejects.toThrow('network mismatch');
    expect(await updateCount(id)).toBe(0n);
  });
  it('never acknowledges malformed matching events or oversized ordering probes', async () => {
    const id = await projection();
    const malformed = await admit(id, 'driver_assigned');
    await prisma.blockchainEvent.update({
      where: { id: malformed },
      data: { payload: [id.toString(), 'invalid-address'] },
    });
    await expect(consume(malformed)).rejects.toThrow('malformed delivery mutation');
    expect(await completions(malformed)).toEqual([]);
    const eventId = await admit(id, 'delivery_confirmed', 3n);
    await prisma.blockchainEvent.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        contractName: 'delivery',
        network,
        rpcEventId: `probe-${i}`,
        ledgerSeq: 2n,
        txHash: 'fixture',
        topic: ['delivery_created'],
        payload: ['999'],
        ledgerClosedAt: new Date('2026-10-03'),
      })),
    });
    await expect(consume(eventId)).rejects.toThrow('ordering probe budget exceeded');
    expect(await completions(eventId)).toEqual([]);
    // Remove only this owned fixture probe, so subsequent crash tests have no artificial backlog.
    await prisma.blockchainEvent.deleteMany({
      where: { network, rpcEventId: { startsWith: 'probe-' } },
    });
  });
  it('a killed process before commit rolls back and a retry safely commits once', async () => {
    const id = await projection();
    const eventId = await admit(id, 'driver_assigned');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION delivery_atomic_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER delivery_atomic_pause BEFORE INSERT ON event_consumer_completions FOR EACH ROW EXECUTE FUNCTION delivery_atomic_pause()`,
    );
    const child = fork(
      fileURLToPath(new URL('./__fixtures__/atomic-delivery-worker.ts', import.meta.url)),
      [eventId],
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
      let paused = false;
      for (let i = 0; i < 150; i++) {
        const rows = await prisma.$queryRaw<
          Array<{ pid: number }>
        >`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'PgSleep' AND pid <> pg_backend_pid()`;
        if (rows.length) {
          paused = true;
          child.kill('SIGKILL');
          await exited;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(paused).toBe(true);
      expect(child.signalCode).toBe('SIGKILL');
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER delivery_atomic_pause ON event_consumer_completions',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION delivery_atomic_pause()');
    }
    expect(await completions(eventId)).toEqual([]);
    expect((await repository.findByChainId(id))?.status).toBe('PENDING');
    expect(await position(id)).toEqual([{ last_ledger_seq: 1n }]);
    expect(await updateCount(id)).toBe(0n);
    expect(await consume(eventId)).toBe('completed');
    expect(await updateCount(id)).toBe(1n);
  });
  it('a crash after commit preserves success and retry does not repeat effects', async () => {
    const id = await projection();
    const eventId = await admit(id, 'driver_assigned');
    const child = fork(
      fileURLToPath(new URL('./__fixtures__/atomic-delivery-worker.ts', import.meta.url)),
      [eventId, 'crash-after-commit'],
      {
        execArgv: [
          '--import',
          fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url)),
        ],
        env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      },
    );
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    expect(child.signalCode).toBe('SIGKILL');
    expect(await consume(eventId)).toBe('already_completed');
    expect(await updateCount(id)).toBe(1n);
    expect(await completions(eventId)).toEqual([{ consumer_id: 'deliveries' }]);
  });
});
