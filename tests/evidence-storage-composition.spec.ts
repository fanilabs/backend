import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalEvidenceStorage } from '../src/modules/disputes/infrastructure/local-evidence-storage.js';
import { createUploadEvidenceUseCase } from '../src/modules/disputes/application/upload-evidence.js';
import { createDownloadEvidenceUseCase } from '../src/modules/disputes/application/download-evidence.js';
import { createGetDisputeUseCase } from '../src/modules/disputes/application/get-dispute.js';
import {
  EvidenceNotFoundError,
  ForbiddenEvidenceAccessError,
} from '../src/modules/disputes/domain/index.js';
import {
  buildChainDisputeCase,
  buildDispute,
  createFakeDisputeContractReader,
  createFakeEvidenceStorage,
  createFakeWalletOwnershipRepository,
  createInMemoryDisputeRepository,
  createInMemoryEvidenceRepository,
} from '../src/modules/disputes/application/__fixtures__/fakes.js';

describe('evidence storage port and composition', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'evidence-port-'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(baseDir, { recursive: true, force: true });
  });

  it('round-trips upload/download through real storage without changing ownership or hash confirmation', async () => {
    const evidenceStorage = createLocalEvidenceStorage(baseDir);
    const disputeRepository = createInMemoryDisputeRepository();
    const evidenceRepository = createInMemoryEvidenceRepository();
    const walletOwnershipRepository = createFakeWalletOwnershipRepository();
    const dispute = buildDispute();
    disputeRepository.seed(dispute);
    walletOwnershipRepository.seed('uploader', dispute.raisedBy);
    const upload = createUploadEvidenceUseCase({
      evidenceStorage,
      disputeRepository,
      evidenceRepository,
      walletOwnershipRepository,
    });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 42]);
    const { evidence } = await upload({
      chainDeliveryId: dispute.chainDeliveryId,
      uploadedBy: dispute.raisedBy,
      requesterId: 'uploader',
      contentType: 'image/png',
      bytes,
    });
    expect(evidence.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(evidence.uploadedByUserId).toBe('uploader');
    expect(evidence.storageUrl.startsWith(`${dispute.id}/`)).toBe(true);
    expect(await readFile(join(baseDir, evidence.storageUrl))).toEqual(bytes);

    const download = createDownloadEvidenceUseCase({
      evidenceStorage,
      disputeRepository,
      evidenceRepository,
      walletOwnershipRepository,
    });
    await expect(
      download({ evidenceId: evidence.id, requesterId: 'stranger', requesterRole: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(ForbiddenEvidenceAccessError);
    await expect(
      download({ evidenceId: evidence.id, requesterId: 'uploader', requesterRole: 'CUSTOMER' }),
    ).resolves.toEqual({ contentType: 'image/png', bytes });

    const contractReader = createFakeDisputeContractReader();
    contractReader.seed(
      dispute.chainDeliveryId,
      buildChainDisputeCase({ evidenceHashes: [evidence.hash] }),
    );
    const getDispute = createGetDisputeUseCase({
      disputeRepository,
      evidenceRepository,
      contractReader,
    });
    expect(
      (await getDispute({ chainDeliveryId: dispute.chainDeliveryId })).evidence[0]
        ?.confirmedOnChain,
    ).toBe(true);
    contractReader.seed(dispute.chainDeliveryId, buildChainDisputeCase({ evidenceHashes: [] }));
    expect(
      (await getDispute({ chainDeliveryId: dispute.chainDeliveryId })).evidence[0]
        ?.confirmedOnChain,
    ).toBe(false);
    await evidenceStorage.delete(evidence.storageUrl);
    await expect(
      download({ evidenceId: evidence.id, requesterId: 'uploader', requesterRole: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(EvidenceNotFoundError);
  });

  it.each(['dispute/old-file', 'local://evidence/dispute/uuid-photo.png'])(
    'reads and deletes an existing key without rewriting it: %s',
    async (storageUrl) => {
      const relative = storageUrl.replace('local://evidence/', '');
      const absolute = join(baseDir, relative);
      await mkdir(join(baseDir, 'dispute'));
      await writeFile(absolute, 'existing-evidence');
      const storage = createLocalEvidenceStorage(baseDir);
      await expect(storage.read(storageUrl)).resolves.toEqual(Buffer.from('existing-evidence'));
      await storage.delete(storageUrl);
      await expect(stat(absolute)).rejects.toThrow();
      await expect(storage.delete(storageUrl)).resolves.toBeUndefined();
      await expect(stat(baseDir)).resolves.toBeDefined();
    },
  );

  it('deletes only the selected file, preserving siblings and the base directory', async () => {
    const storage = createLocalEvidenceStorage(baseDir);
    const first = await storage.save({
      disputeId: 'shared',
      contentType: 'application/pdf',
      bytes: Buffer.from('first'),
    });
    const second = await storage.save({
      disputeId: 'shared',
      contentType: 'application/pdf',
      bytes: Buffer.from('second'),
    });
    await storage.delete(first.storageUrl);
    await expect(storage.read(second.storageUrl)).resolves.toEqual(Buffer.from('second'));
    await expect(stat(join(baseDir, 'shared'))).resolves.toBeDefined();
    await storage.delete(second.storageUrl);
    await expect(stat(join(baseDir, 'shared'))).rejects.toThrow();
    await expect(stat(baseDir)).resolves.toBeDefined();
  });

  it('rejects traversal and base-directory references for read, delete and save', async () => {
    const storage = createLocalEvidenceStorage(baseDir);
    const outside = `${baseDir}-outside`;
    await writeFile(outside, 'untouched');
    try {
      for (const key of [
        '../' + outside.split('/').pop(),
        'local://evidence/../../outside',
        outside,
        '.',
        'local://evidence/',
      ]) {
        await expect(storage.read(key)).rejects.toBeInstanceOf(EvidenceNotFoundError);
        await expect(storage.delete(key)).rejects.toBeInstanceOf(EvidenceNotFoundError);
      }
      await expect(
        storage.save({
          disputeId: '../escape',
          contentType: 'image/png',
          bytes: Buffer.from('bad'),
        }),
      ).rejects.toBeInstanceOf(EvidenceNotFoundError);
      expect(await readFile(outside, 'utf8')).toBe('untouched');
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('implements fixture deletion rather than silently retaining deleted bytes', async () => {
    const storage = createFakeEvidenceStorage();
    const { storageUrl } = await storage.save({
      disputeId: 'fake',
      contentType: 'image/png',
      bytes: Buffer.from('fixture'),
    });
    await expect(storage.read(storageUrl)).resolves.toEqual(Buffer.from('fixture'));
    await storage.delete(storageUrl);
    await expect(storage.read(storageUrl)).rejects.toThrow();
    await expect(storage.delete(storageUrl)).resolves.toBeUndefined();
  });

  it('constructs the actual production dispute module with a temporary configured storage directory', async () => {
    // Reparse config for this isolated composition probe, without mocking the factory.
    vi.resetModules();
    vi.stubEnv('EVIDENCE_STORAGE_DIR', join(baseDir, 'configured'));
    vi.stubEnv('DISPUTE_RESOLUTION_CONTRACT_ID', '');
    vi.stubEnv('ESCROW_CONTRACT_ID', '');
    const { createDisputesModule } = await import('../src/modules/disputes/index.js');
    const prisma = new PrismaClient();
    try {
      expect(createDisputesModule(prisma)).toBeTypeOf('function');
      await expect(stat(join(baseDir, 'configured'))).resolves.toBeDefined();
    } finally {
      await prisma.$disconnect();
    }
  });
});
