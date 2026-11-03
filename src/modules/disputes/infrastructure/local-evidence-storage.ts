import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { EvidenceStorage } from '../domain/index.js';
import { EvidenceNotFoundError } from '../domain/index.js';

const STORAGE_URL_PREFIX = 'local://evidence/';

/** Local keys retain the original <disputeId>/<fileId> layout. Reads and
 * deletes also accept keys written with the later local://evidence/ prefix;
 * stored evidence references do not need rewriting. */
export function createLocalEvidenceStorage(baseDir: string): EvidenceStorage {
  const resolvedBaseDir = resolve(baseDir);
  const basePrefix = resolvedBaseDir.endsWith(sep) ? resolvedBaseDir : `${resolvedBaseDir}${sep}`;

  function resolveStoragePath(storageUrl: string): string {
    if (storageUrl.includes('://') && !storageUrl.startsWith(STORAGE_URL_PREFIX)) {
      throw new EvidenceNotFoundError();
    }
    const relative = storageUrl.startsWith(STORAGE_URL_PREFIX)
      ? storageUrl.slice(STORAGE_URL_PREFIX.length)
      : storageUrl;
    const absolute = resolve(resolvedBaseDir, relative);
    if (absolute === resolvedBaseDir || !absolute.startsWith(basePrefix)) {
      throw new EvidenceNotFoundError();
    }
    return absolute;
  }

  return {
    async save({ disputeId, bytes }) {
      const storageUrl = `${disputeId}/${randomUUID()}`;
      const absolute = resolveStoragePath(storageUrl);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
      return { storageUrl };
    },

    async read(storageUrl) {
      const absolute = resolveStoragePath(storageUrl);
      try {
        return await readFile(absolute);
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          throw new EvidenceNotFoundError();
        }
        throw error;
      }
    },

    async delete(storageUrl) {
      const absolute = resolveStoragePath(storageUrl);
      await rm(absolute, { force: true });

      // Remove only empty ancestors, preserving the configured base directory
      // and directories containing other evidence.
      let current = dirname(absolute);
      while (current !== resolvedBaseDir && current.startsWith(basePrefix)) {
        try {
          await rmdir(current);
        } catch {
          break;
        }
        current = dirname(current);
      }
    },
  };
}
