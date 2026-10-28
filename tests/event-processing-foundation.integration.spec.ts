import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaEventStore } from '../src/modules/indexer/infrastructure/prisma-event-store.js';
import { eventProcessingStatus } from '../src/modules/indexer/infrastructure/event-processing-status.js';
import {
  CONSUMER_IDS,
  missingRequiredConsumers,
  processingPolicy,
} from '../src/modules/indexer/domain/processing-policy.js';

// Real disposable database; each run owns a separate schema. No availability skips.
const schema = `m10_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
databaseUrl.searchParams.set('schema', schema);
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
const admin = new PrismaClient();
const network = `foundation-${randomUUID()}`;
const event = (rpcEventId: string = randomUUID(), topic = 'delivery_created') => ({
  contractName: 'delivery',
  network,
  rpcEventId,
  ledgerSeq: 1n,
  txHash: 'fixture',
  topic: [topic],
  payload: [],
  closedAt: new Date('2026-10-28T00:00:00Z'),
});
let historicalId: string;
async function idFor(rpcEventId: string) {
  const row = await prisma.blockchainEvent.findUniqueOrThrow({
    where: { contractName_network_rpcEventId: { contractName: 'delivery', network, rpcEventId } },
  });
  return row.id;
}
beforeAll(async () => {
  if (process.env.NODE_ENV !== 'test') throw new Error('Disposable test environment required');
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  // Extract the actual historical raw-event table and unique index, without
  // replaying or rewriting the known-broken full migration chain.
  const initial = readFileSync('prisma/migrations/20260807104052_init/migration.sql', 'utf8');
  const table = initial.match(/CREATE TABLE "blockchain_events"[\s\S]*?;/)?.[0];
  const unique = initial.match(
    /CREATE UNIQUE INDEX "blockchain_events_contract_name_network_rpc_event_id_key"[^;]*;/,
  )?.[0];
  if (!table || !unique) throw new Error('Historical event schema fixture not found');
  await prisma.$executeRawUnsafe(table);
  await prisma.$executeRawUnsafe(unique);
  const old = await prisma.blockchainEvent.create({
    data: {
      contractName: 'delivery',
      network,
      rpcEventId: 'legacy',
      ledgerSeq: 1n,
      txHash: 'old',
      topic: ['delivery_created'],
      payload: [],
      ledgerClosedAt: new Date('2026-01-01'),
      processedAt: new Date('2026-01-02'),
    },
  });
  historicalId = old.id;
  const sql = readFileSync(
    'prisma/migrations/20261028150000_event_processing_foundation/migration.sql',
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
describe('durable admission foundation (execution stays blocked)', () => {
  it('preserves historical unknown, even with old processedAt, on duplicate receipt', async () => {
    expect(await createPrismaEventStore(prisma).tryInsert(event('legacy'))).toBe(false);
    expect(await eventProcessingStatus(prisma, historicalId)).toEqual({
      status: 'historical_unknown',
      complete: false,
    });
    expect(
      (await prisma.blockchainEvent.findUniqueOrThrow({ where: { id: historicalId } })).processedAt,
    ).toEqual(new Date('2026-01-02'));
  });
  it('atomically admits required identities and exposes missing registration without completion', async () => {
    const e = event();
    expect(await createPrismaEventStore(prisma).tryInsert(e)).toBe(true);
    const state = await eventProcessingStatus(prisma, await idFor(e.rpcEventId));
    expect(state).toMatchObject({
      status: 'blocked',
      complete: false,
      policyVersion: 1,
      reason: 'consumer_recovery_not_verified',
      missingRegistrations: ['deliveries', 'fraud-activity'],
    });
    expect(state).toHaveProperty('obligations', [
      { consumer_id: 'deliveries', blocked_reason: 'consumer_recovery_not_verified' },
      { consumer_id: 'fraud-activity', blocked_reason: 'consumer_recovery_not_verified' },
    ]);
    expect(
      await eventProcessingStatus(prisma, await idFor(e.rpcEventId), CONSUMER_IDS),
    ).toMatchObject({ complete: false, missingRegistrations: [] });
  });
  it('rolls back raw persistence when obligation admission fails, and allows safe receipt retry', async () => {
    // Real database failure, after raw insert and receipt insert, without mocking Prisma.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION foundation_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture obligation failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER foundation_test_fail BEFORE INSERT ON event_consumer_obligations FOR EACH ROW EXECUTE FUNCTION foundation_test_fail()`,
    );
    const e = event();
    try {
      await expect(createPrismaEventStore(prisma).tryInsert(e)).rejects.toThrow(
        'fixture obligation failure',
      );
      expect(
        await prisma.blockchainEvent.count({ where: { network, rpcEventId: e.rpcEventId } }),
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER foundation_test_fail ON event_consumer_obligations',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION foundation_test_fail()');
    }
    expect(await createPrismaEventStore(prisma).tryInsert(e)).toBe(true);
  });
  it('recovers after the admitting process is killed before commit', async () => {
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION foundation_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER foundation_test_pause BEFORE INSERT ON event_consumer_obligations FOR EACH ROW EXECUTE FUNCTION foundation_test_pause()`,
    );
    const e = event();
    const child = fork(
      fileURLToPath(new URL('./__fixtures__/event-admission-worker.ts', import.meta.url)),
      [network, e.rpcEventId],
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
      for (let i = 0; i < 100; i++) {
        const sessions = await prisma.$queryRaw<Array<{ pid: number }>>`
          SELECT pid FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event = 'PgSleep' AND pid <> pg_backend_pid()`;
        if (sessions[0]) {
          child.kill('SIGKILL');
          await exited;
          killed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(killed).toBe(true);
      expect(child.signalCode).toBe('SIGKILL');
      expect(
        await prisma.blockchainEvent.count({ where: { network, rpcEventId: e.rpcEventId } }),
      ).toBe(0);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER foundation_test_pause ON event_consumer_obligations',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION foundation_test_pause()');
    }
    expect(await createPrismaEventStore(prisma).tryInsert(e)).toBe(true);
  });

  it('retains blocked obligations after client restart, without initiating consumer effects', async () => {
    const e = event();
    await createPrismaEventStore(prisma).tryInsert(e);
    const id = await idFor(e.rpcEventId);
    const restarted = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
    try {
      expect(await eventProcessingStatus(restarted, id)).toMatchObject({
        status: 'blocked',
        complete: false,
      });
      expect(await createPrismaEventStore(restarted).tryInsert(e)).toBe(false);
      expect(await eventProcessingStatus(restarted, id)).toHaveProperty('obligations.length', 2);
    } finally {
      await restarted.$disconnect();
    }
  });
  it('serializes concurrent duplicate receipts to one raw event and one obligation per consumer', async () => {
    const e = event();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => createPrismaEventStore(prisma).tryInsert(e)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const state = await eventProcessingStatus(prisma, await idFor(e.rpcEventId));
    expect(state).toHaveProperty('obligations.length', 2);
    expect(state.complete).toBe(false);
  });
  it('keeps unknown events and the unresolved users projection blocked with no false empty-set success', async () => {
    const unresolved: Array<[string, string, string]> = [
      ['delivery', 'new_event', 'event_policy_unresolved'],
      ['identity-reputation', 'user_registered', 'users_projection_unresolved'],
    ];
    for (const [contractName, topic, reason] of unresolved) {
      const e = { ...event(), contractName, topic: [topic] };
      await createPrismaEventStore(prisma).tryInsert(e);
      const row = await prisma.blockchainEvent.findFirstOrThrow({
        where: { network, rpcEventId: e.rpcEventId },
      });
      expect(await eventProcessingStatus(prisma, row.id)).toMatchObject({
        complete: false,
        reason,
        obligations: [],
      });
    }
  });
  it('matches all 48 investigated requirements with stable identities', () => {
    const cases: Array<[string, string[], string[]]> = [
      ['delivery', ['delivery_created'], ['deliveries', 'fraud-activity']],
      [
        'delivery',
        ['driver_assigned', 'DeliveryInTransit', 'delivery_confirmed', 'delivery_cancelled'],
        ['deliveries', 'notification-intent'],
      ],
      ['delivery', ['delivery_disputed'], ['deliveries']],
      ['escrow', ['escrow_funded'], ['escrow']],
      ['escrow', ['escrow_released'], ['escrow', 'fraud-activity', 'notification-intent']],
      [
        'escrow',
        ['delivery_disputed'],
        ['escrow', 'disputes', 'fraud-activity', 'notification-intent'],
      ],
      ['escrow', ['escrow_refunded'], ['escrow', 'notification-intent']],
      ['escrow', ['dispute_resolved'], ['escrow', 'disputes']],
      [
        'dispute-resolution',
        [
          'dispute_raised',
          'dispute_resolved_refund',
          'dispute_resolved_split',
          'dispute_resolved_payout',
        ],
        ['disputes', 'notification-intent'],
      ],
      [
        'identity-reputation',
        ['driver_registered', 'kyc_status_updated', 'reputation_increased', 'reputation_decreased'],
        ['reputation', 'notification-intent'],
      ],
      [
        'fleet',
        ['fleet_registered', 'driver_invited', 'invite_accepted', 'driver_removed'],
        ['fleet', 'notification-intent'],
      ],
      ['fleet', ['fleet_treasury_updated'], ['fleet']],
    ];
    let count = 0;
    for (const [contract, topics, required] of cases)
      for (const topic of topics) {
        expect(processingPolicy(contract, [topic]).required).toEqual(required);
        count += required.length;
      }
    expect(count).toBe(48);
    expect(missingRequiredConsumers(['deliveries', 'fraud-activity'], ['deliveries'])).toEqual([
      'fraud-activity',
    ]);
  });
});
