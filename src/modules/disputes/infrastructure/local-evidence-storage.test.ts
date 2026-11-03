import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalEvidenceStorage } from './local-evidence-storage.js';

describe('createLocalEvidenceStorage', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'evidence-storage-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('saves, reads, and deletes evidence files from disk', async () => {
    const storage = createLocalEvidenceStorage(baseDir);
    const data = Buffer.from('evidence-bytes');

    const { storageUrl } = await storage.save({
      disputeId: 'dispute-1',
      contentType: 'image/png',
      bytes: data,
    });

    const absolute = join(baseDir, storageUrl.replace('local://evidence/', ''));
    await expect(stat(absolute)).resolves.toBeDefined();
    await expect(storage.read(storageUrl)).resolves.toEqual(data);

    await storage.delete(storageUrl);

    await expect(stat(absolute)).rejects.toThrow();
  });

  it('removes empty dispute directories on delete', async () => {
    const storage = createLocalEvidenceStorage(baseDir);

    const { storageUrl } = await storage.save({
      disputeId: 'dispute-2',
      contentType: 'video/mp4',
      bytes: Buffer.from('video-bytes'),
    });

    const disputeDir = join(baseDir, 'dispute-2');
    await expect(stat(disputeDir)).resolves.toBeDefined();

    await storage.delete(storageUrl);

    await expect(stat(disputeDir)).rejects.toThrow();
  });

  it('is idempotent when deleting a missing file', async () => {
    const storage = createLocalEvidenceStorage(baseDir);

    await expect(storage.delete('local://evidence/dispute-3/missing.png')).resolves.toBeUndefined();
  });
});
