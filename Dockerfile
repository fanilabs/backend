# syntax=docker/dockerfile:1

FROM node:26-slim AS base
# `node:20-slim` doesn't ship OpenSSL as an OS package — Prisma's query
# engine binary is dynamically linked against libssl and fails at runtime
# ("Prisma cannot find the required libssl system library") without it,
# even though `prisma generate` succeeds at build time. Verified the hard
# way (first real `docker compose up` run, Phase 6) — exactly the warning
# `prisma generate`'s own output already gives for this situation.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ── deps: install once, reused by build and by dev ──────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── build: compile TypeScript ────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm build

# ── prod-deps: full install (needed so `prisma generate`'s postinstall
# hook has the `prisma` CLI devDependency to run against), then pruned to
# production packages only. This used to install `--prod --ignore-scripts`
# directly and copy the generated `.prisma` client in from the `build`
# stage — broken in practice (verified the hard way, first real
# `docker compose up` run, Phase 6): under pnpm's default isolated
# node_modules layout, `@prisma/client`'s virtual-store directory name
# encodes which peer/dev dependencies are present in *that stage's own*
# install, so the path a full install (`deps`/`build`) generates the
# client under doesn't reliably match where a `--prod`-only install
# expects to find it — there is no single `node_modules/.prisma` to copy
# the way there would be under npm/yarn's flat layout. Installing fully
# and pruning afterward sidesteps the whole class of problem: the
# generated `.prisma` client lives inside `@prisma/client`'s own installed
# directory, not `prisma`'s, so `pnpm prune --prod` (which removes the
# `prisma` CLI devDependency package itself) leaves it untouched. ────────────
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
# `--ignore-scripts` here, not on the install above: pruning re-triggers
# lifecycle scripts for whatever remains (including this project's own
# `postinstall: prisma generate`), which would fail — by the time pruning
# runs, the `prisma` devDependency it needs has already been removed. The
# client generated during the full install above is untouched either way.
RUN pnpm prune --prod --ignore-scripts

# ── api: HTTP server image ───────────────────────────────────────────────────
FROM base AS api
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
# Evidence upload writes here at runtime as the unprivileged `node` user —
# created and owned up front since USER below switches away from root before
# any request can trigger the mkdir this directory needs.
RUN mkdir -p /var/lib/fanilab/evidence && chown -R node:node /var/lib/fanilab/evidence
EXPOSE 3000
USER node
# Matches docs/DEPLOYMENT.md's instruction to point an orchestrator's
# readiness probe at GET /health — this gives `docker compose`/Swarm/plain
# `docker run` the same signal without one.
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# ── worker: BullMQ background-processing image ───────────────────────────────
FROM base AS worker
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
# Same ownership fix as the api stage — createDisputesModule's evidence
# storage is also constructed in this process (see src/workers/index.ts).
RUN mkdir -p /var/lib/fanilab/evidence /var/lib/fanilab/heartbeat \
    && chown -R node:node /var/lib/fanilab
USER node
# The worker has no HTTP surface, so liveness is a heartbeat file
# (src/workers/index.ts) touched on every poll tick instead of an HTTP probe.
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const fs=require('fs');try{const s=fs.statSync('/var/lib/fanilab/heartbeat/worker.heartbeat');process.exit(Date.now()-s.mtimeMs<45000?0:1)}catch(e){process.exit(1)}"
CMD ["node", "dist/workers/index.js"]
