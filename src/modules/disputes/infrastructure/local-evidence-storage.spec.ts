import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalEvidenceStorage } from './local-evidence-storage.js';
import { EvidenceNotFoundError } from '../domain/index.js';

describe('createLocalEvidenceStorage', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'fanilab-evidence-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('round-trips the exact bytes it was given', async () => {
    const storage = createLocalEvidenceStorage(baseDir);
    const bytes = Buffer.from('evidence-file-contents');
    const disputeId = randomUUID();

    const { storageUrl } = await storage.save({
      disputeId,
      contentType: 'application/pdf',
      bytes,
    });
    const read = await storage.read(storageUrl);

    expect(read).toEqual(bytes);
    expect(storageUrl.startsWith(`${disputeId}/`)).toBe(true);
  });

  it('rejects a storageUrl that attempts to escape baseDir', async () => {
    const storage = createLocalEvidenceStorage(baseDir);

    await expect(storage.read('../../etc/passwd')).rejects.toThrow('Invalid evidence storage path');
  });

  it('maps a missing file to EvidenceNotFoundError instead of a raw ENOENT', async () => {
    const storage = createLocalEvidenceStorage(baseDir);
    const missingStorageUrl = `${randomUUID()}/${randomUUID()}`;

    await expect(storage.read(missingStorageUrl)).rejects.toThrow(EvidenceNotFoundError);
  });
});
