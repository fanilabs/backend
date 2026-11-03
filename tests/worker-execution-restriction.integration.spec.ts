import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Address } from '@stellar/stellar-sdk';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { workerExecutionStatus } from '../src/shared/queue/worker-execution.js';

const prisma = new PrismaClient();
const redis = new Redis(
  process.env.SECURITY_TEST_REDIS_SOCKET ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
  { maxRetriesPerRequest: null },
);
const queues = workerExecutionStatus.jobs.map(
  ({ queue }) => new Queue(queue, { connection: redis }),
);
const prefix = randomUUID();
const address = `restriction-${prefix}`;
const jobs: Array<{ queue: Queue; id: string }> = [];
const repeatKeys: Array<{ queue: Queue; key: string }> = [];
const repeatsBefore = new Map<string, Awaited<ReturnType<Queue['getRepeatableJobs']>>>();
let userId: string;
let notificationId: string;
let heartbeatDir: string;

beforeAll(async () => {
  heartbeatDir = await mkdtemp(path.join(tmpdir(), 'restricted-worker-'));
  const user = await prisma.user.create({
    data: { email: `${prefix}@worker.invalid`, passwordHash: 'synthetic-only' },
  });
  userId = user.id;
  const notification = await prisma.notification.create({
    data: { userId, channel: 'EMAIL', type: 'fixture', payload: { synthetic: true } },
  });
  notificationId = notification.id;
  await prisma.actorActivity.createMany({
    data: [1, 100].map((days) => ({
      address,
      category: 'DELIVERY_CREATED',
      occurredAt: new Date(Date.now() - days * 86400000),
    })),
  });
  for (const queue of queues) {
    const job = await queue.add(
      'restriction-fixture',
      {
        notificationId,
        contractName: 'escrow',
        contractId: Address.contract(Buffer.alloc(32, 8)).toString(),
        network: 'testnet',
      },
      { jobId: `${prefix}-${queue.name}` },
    );
    if (!job.id) throw new Error('Expected fixture job ID');
    jobs.push({ queue, id: job.id });
    const oldKeys = new Set((await queue.getRepeatableJobs()).map((repeat) => repeat.key));
    await queue.add(
      'legacy-fixture',
      {},
      {
        jobId: `${prefix}-legacy-${queue.name}`,
        repeat: { every: 86_400_000 },
      },
    );
    const repeats = await queue.getRepeatableJobs();
    for (const repeat of repeats) {
      if (!oldKeys.has(repeat.key)) repeatKeys.push({ queue, key: repeat.key });
    }
    repeatsBefore.set(queue.name, repeats);
  }
});

afterAll(async () => {
  for (const { queue, id } of jobs) await (await queue.getJob(id))?.remove();
  for (const { queue, key } of repeatKeys) await queue.removeRepeatableByKey(key);
  await Promise.all(queues.map((queue) => queue.close()));
  await redis.quit();
  await prisma.actorActivity.deleteMany({ where: { address } });
  if (userId) await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
  if (heartbeatDir) await rm(heartbeatDir, { recursive: true, force: true });
});

function childProcess(args: string[]) {
  const contract = Address.contract(Buffer.alloc(32, 8)).toString();
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      WORKER_HEARTBEAT_DIR: heartbeatDir,
      // Valid settings and configured contracts must not unlock execution.
      NOTIFICATION_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: '9',
      SMTP_FROM: 'fixture@worker.invalid',
      ESCROW_CONTRACT_ID: contract,
      DELIVERY_CONTRACT_ID: contract,
      FLEET_MANAGEMENT_CONTRACT_ID: contract,
      DISPUTE_RESOLUTION_CONTRACT_ID: contract,
      IDENTITY_REPUTATION_CONTRACT_ID: contract,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const finished = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Child timeout: ${output}`));
    }, 10_000);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
  });
  return { child, finished, output: () => output };
}

async function assertNoEffects() {
  expect(
    (await prisma.notification.findUniqueOrThrow({ where: { id: notificationId } })).status,
  ).toBe('PENDING');
  expect(await prisma.actorActivity.count({ where: { address } })).toBe(2);
  for (const { queue, id } of jobs) {
    expect(await (await queue.getJob(id))?.getState()).toBe('waiting');
    expect(await queue.getWorkers()).toHaveLength(0);
    expect(await queue.getRepeatableJobs()).toEqual(repeatsBefore.get(queue.name));
  }
}

it('imports the production entrypoint without timers, consumers or scheduler registration', async () => {
  const probe = childProcess([
    '--input-type=module',
    '-e',
    'await import("./src/workers/index.ts"); console.log("import complete");',
  ]);
  expect(await probe.finished).toBe(0);
  expect(probe.output()).toContain('import complete');
  expect(probe.output()).not.toContain('Worker supervisor started');
  await expect(readFile(path.join(heartbeatDir, 'worker.heartbeat'))).rejects.toThrow();
  await assertNoEffects();
});

it('starts in production with all jobs explicitly blocked, preserves pending data and shuts down', async () => {
  const probe = childProcess(['src/workers/index.ts']);
  try {
    for (
      let attempt = 0;
      attempt < 100 && !probe.output().includes('no jobs are running');
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const logs = probe
      .output()
      .split('\n')
      .filter(Boolean)
      .map(
        (line: string) => JSON.parse(line) as { workerExecution?: unknown; workerCount?: number },
      );
    expect(logs).toContainEqual(
      expect.objectContaining({ workerCount: 0, workerExecution: workerExecutionStatus }),
    );
    expect(await readFile(path.join(heartbeatDir, 'worker.heartbeat'), 'utf8')).toBeTruthy();
    await assertNoEffects();
    probe.child.kill('SIGTERM');
    expect(await probe.finished).toBe(0);
    expect(probe.output()).toContain('Shutting down worker process gracefully');
    expect(probe.output()).not.toContain('Notification delivered');
    expect(probe.output()).not.toContain('retention cleanup complete');
    await assertNoEffects();
  } finally {
    if (probe.child.exitCode === null) probe.child.kill('SIGKILL');
  }
});
