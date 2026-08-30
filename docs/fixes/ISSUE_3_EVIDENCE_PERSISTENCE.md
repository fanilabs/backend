# Issue 3 — Evidence files lost on container recreation

## Problem

`EVIDENCE_STORAGE_DIR` defaulted to the relative path `./storage/evidence`,
which resolves inside the container's writable layer. `docker-compose.yml`
declared volumes for Postgres, Redis, Prometheus and Grafana, but not for
the API's evidence directory. `docker compose up --build`, `docker compose
down`, or any container recreation destroyed every uploaded evidence file,
while the corresponding `Evidence` rows — with their `storageUrl` and
content hash — survived in Postgres. A subsequent download then failed with
an unmapped `ENOENT` surfacing as a `500`.

## What changed

- **`docker-compose.yml`** — added a named volume, `evidence-data`, mounted
  into the `api` service at `/var/lib/fanilab/evidence` (the same absolute
  path issue #2 already chowns to the `node` user in the `Dockerfile`), so
  evidence now persists exactly like `postgres-data` does. Documented the
  volume's backup requirement alongside its declaration.
- **`src/shared/config/env.ts`** — expanded the doc comment on
  `EVIDENCE_STORAGE_DIR` to state plainly that the relative default is a
  development-only convenience and that a deployed environment must point it
  at an absolute, persistently-mounted path.
- **`src/modules/disputes/infrastructure/local-evidence-storage.ts`** —
  `read()` now catches `ENOENT` specifically and throws the existing domain
  `EvidenceNotFoundError` (already used elsewhere in this module for a
  missing DB row) instead of letting a raw `ENOENT` propagate to the generic
  500 handler. A genuinely missing file now returns a standard 404 envelope.
- **`local-evidence-storage.spec.ts`** — added a unit test asserting a
  missing `storageUrl` rejects with `EvidenceNotFoundError`.
- **`docs/DEPLOYMENT.md`** — documented the `evidence-data` volume, its
  backup requirement, and the 404 mapping under § Evidence Storage.

## Verification

Not run in this change. Manually verify with:

```bash
# upload evidence, then:
docker compose down && docker compose up
# download should still succeed

# then, for the 404 path:
pnpm vitest run src/modules/disputes/infrastructure/local-evidence-storage.spec.ts
```
