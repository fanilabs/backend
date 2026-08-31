import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EvidenceStorage } from '../domain/index.js';
import { EvidenceNotFoundError } from '../domain/index.js';

function isEnoentError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/**
 * Local-filesystem-backed `EvidenceStorage` for v1 (ROADMAP.md §2 objective
 * 5 calls for "object storage" without mandating a specific backend, and no
 * S3-compatible client is a dependency of this project yet). The port
 * (`domain/ports.ts`) is deliberately storage-agnostic so a real
 * S3-compatible adapter can replace this later without any application-layer
 * change — swap what `createDisputesModule` wires up in `disputes/index.ts`.
 *
 * `storageUrl` is an opaque `"<disputeId>/<fileId>"` relative path, not a
 * real URL — `read()` resolves it against `baseDir` and rejects anything
 * that would escape it, since the value round-trips through this backend's
 * own API responses and should be treated as untrusted by the time it comes
 * back in a request.
 */
export function createLocalEvidenceStorage(baseDir: string): EvidenceStorage {
  const resolvedBaseDir = path.resolve(baseDir);

  return {
    async save({ disputeId, bytes }) {
      const dir = path.join(resolvedBaseDir, disputeId);
      await mkdir(dir, { recursive: true });
      const fileId = randomUUID();
      await writeFile(path.join(dir, fileId), bytes);
      return { storageUrl: `${disputeId}/${fileId}` };
    },

    async read(storageUrl) {
      const resolved = path.resolve(resolvedBaseDir, storageUrl);
      if (!resolved.startsWith(resolvedBaseDir + path.sep)) {
        throw new Error('Invalid evidence storage path');
      }
      try {
        return await readFile(resolved);
      } catch (error) {
        // A genuinely missing file (deleted out-of-band, or a storageUrl
        // whose bytes were never persisted — e.g. lost with the container's
        // writable layer before the evidence-data volume existed) should
        // surface as a domain 404, not an unmapped 500.
        if (isEnoentError(error)) {
          throw new EvidenceNotFoundError();
        }
        throw error;
      }
    },
  };
}
