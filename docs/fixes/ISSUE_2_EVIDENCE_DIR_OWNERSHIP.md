# Issue 2 — Evidence directory ownership / non-root write failure

## Problem

`WORKDIR /app` in the `Dockerfile`'s base stage creates `/app` owned by
`root`. The final `api` stage copies files in as root, then switches to
`USER node`. At runtime, `local-evidence-storage.ts` calls
`mkdir('/app/storage/evidence', { recursive: true })` — a write into a
root-owned directory by an unprivileged user, which fails with `EACCES`. The
error wasn't mapped by the error handler, so the first evidence upload
returned a generic `500 INTERNAL_ERROR`, and nothing in the boot sequence
checked the storage directory was writable ahead of time.

## What changed

- **`Dockerfile`** (both `api` and `worker` stages) — added
  `RUN mkdir -p /var/lib/fanilab/evidence && chown -R node:node ...` before
  `USER node`, so the directory the app writes to at runtime is owned by the
  user it actually runs as. The container still runs as non-root — only the
  directory ownership changed. (This piece landed together with issue #1's
  Dockerfile edit in the same file region.)
- **`docker-compose.yml`** — `api` and `worker` now set
  `EVIDENCE_STORAGE_DIR=/var/lib/fanilab/evidence`, matching the directory
  the image actually creates/owns, instead of relying on the relative
  `./storage/evidence` default (which resolves against `/app` — the
  root-owned directory that caused the bug in the first place).
- **`src/modules/disputes/index.ts`** — `createDisputesModule` now calls
  `assertEvidenceStorageWritable(config.EVIDENCE_STORAGE_DIR)` before
  constructing the storage adapter. It `mkdir`s the directory and checks
  `W_OK` access; a non-writable directory now throws a clear configuration
  error at boot instead of failing silently until the first upload.
- **`docs/DEPLOYMENT.md`** — new § Evidence Storage documenting the
  directory, its ownership, and the fail-fast boot check.

## Verification

Not run in this change. Manually verify with:

```bash
docker compose up --build
# then upload evidence via POST /api/v1/disputes/:chainDeliveryId/evidence
# and confirm it succeeds end to end (no 500/EACCES).
```
