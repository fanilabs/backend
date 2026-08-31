# FaniLab Backend — Contributor Issue Backlog (archive)

This backlog — 127 contributor-ready issues authored against [`fanilabs/backend`](https://github.com/fanilabs/backend) `main` at commit `ec15e93` (`v1.0.0`) across two independent mining passes — has been **fully published**. All 127 entries are now live as GitHub issues **#9–#135**. Nothing remains unpublished; this file is kept as the audit trail of how the backlog was produced and verified, not as an active queue.

| Backlog range | Published as GitHub issues | Publishing round |
|---|---|---|
| #1–#30 | #9–#38 | First round (first-pass findings) |
| #31–#80 | #39–#88 | Second round (remaining first-pass findings) |
| #81–#127 | #89–#135 | Third round (all second-pass findings) |

Every backlog number maps to GitHub number *backlog + 8* throughout, since GitHub issues and this repository's Dependabot PRs (#1–#8) share one numbering sequence.

Every entry was verified against the actual implementation — file, function, and behaviour — not inferred from documentation. Where a doc and the code disagreed, the code was treated as authoritative and the disagreement was recorded as part of the issue. Each used the same structure: title, topical labels, area/component, then **Problem**, **Current behavior**, **Evidence / code location**, **Impact**, **Expected behavior**, **Proposed scope / implementation direction**, **Acceptance criteria**, **Verification / testing requirements**.

---

## Backlog validation summary

*(Historical record, updated at final publication. The backlog was authored as 100 issues in a first pass, #1–#100, then extended to 127 in a second pass; all 127 have since been published as GitHub issues #9–#135 and removed from this file — see the table at the top of this document.)*

- **Total issues authored:** 127, numbered #1–#127 with no gaps and no duplicates, all now published.
- **Numbering:** sequential and stable throughout authoring; every backlog number maps to GitHub number *backlog + 8*. (`planned.md` is an untracked local draft of Wave candidates, not an established backlog, and was not continued here.)
- **Structure:** every issue carries the same eleven elements — title, topical labels, area/component, Problem, Current behavior, Evidence / code location, Impact, Expected behavior, Proposed scope / implementation direction, Acceptance criteria, Verification / testing requirements.
- **Verification:** every referenced file, function, route, schema field, config variable and documentation section was read in this repository at commit `ec15e93` before being cited.
- **Duplicate check:** GitHub issues #9–#135 are this backlog's full, now-published content; the eight open PRs are all Dependabot version bumps, and no issue here proposed any of those bumps.

### Candidates examined and rejected

| Candidate | Why it was rejected |
|---|---|
| "`.env.example` has drifted from the config schema (25 vars vs 20 schema fields)" | Not true on `main`. Both list the same 25 keys. Only the *unused* `SETTLEMENT_CONTRACT_ID` is a real finding, filed narrowly as GitHub #58. |
| "`docs/API_REFERENCE.md`'s planned-endpoints table is stale, listing shipped `analytics`/`admin` as planned" | Already fixed. The table now contains one accurate row (`POST /transactions/submit`), filed as GitHub #80. |
| "Evidence upload/download has no ownership check (IDOR)" | Already fixed in Phase 6 (`docs/SECURITY.md` § Security Review History). The residual gaps are different and narrower: GitHub #14 (content type), #15 (size), #17 (ownership transfer on wallet unlink). |
| "Rate limiting breaks the API when Redis is down" | Already fixed — `skipOnError: true` is set deliberately in `security.ts` with an explanatory comment. |
| "Prisma client is copied incorrectly in the Dockerfile under pnpm" | Already fixed in Phase 6, with the reasoning preserved in `Dockerfile` comments. |
| "Analytics `disputeRate` can exceed 1" | Not reachable — `Dispute` holds a foreign key to `Delivery`, so a dispute cannot exist without a counted delivery. (That same FK is the subject of GitHub #37 for a different reason.) |
| "`local-evidence-storage.read` is vulnerable to path traversal" | Not reachable — `path.resolve` plus the `startsWith(resolvedBaseDir + path.sep)` guard correctly rejects both absolute and `..`-relative escapes. |
| "`scValToNative` decodes bytes to base64 while `bytesToScVal` expects hex" | Handled deliberately — `disputes-scval-mapping.ts`'s `base64ToHex` normalises at the boundary with an explanatory comment. The narrower real defect (silent truncation of invalid hex) is filed as GitHub #79. |
| Bumping `actions/checkout`, `actions/setup-node`, `pnpm/action-setup`, `actions/upload-artifact`, `softprops/action-gh-release`, the `node` base image, or the npm minor/patch group | Each is already an open Dependabot PR (#1–#8). |
| "`docs/DEPLOYMENT.md` says 'three real bugs' then lists four" | A single-word typo with no behavioural consequence — below the bar for a standalone contributor issue. |

---

## Second-pass validation summary

*(Historical record of the second mining pass. At the time this pass ran, only backlog items #1–#30 had been published, as GitHub #9–#38; items #31–#127 were subsequently published as GitHub #39–#135 across two later publishing rounds, after this pass and its findings were already finalized. The counts and duplicate-check below describe this pass's own methodology and are otherwise unchanged; issue #126, referenced below, is now published as GitHub #134.)*

- **New issues added:** 27, numbered #101–#127, appended after the existing #31–#100.
- **Substantiation note:** the task requested up to 50 new issues. After an extensive, multi-technique second pass — live execution of the installed `@stellar/stellar-sdk`, `bcrypt`, and `jsonwebtoken` packages against constructed edge-case inputs; a `pnpm audit` run against the committed lockfile; a `gh api` query of the repository's own security settings; `git log --follow` against both migration files; five independent systematic greps for duplicated code across layers; and line-by-line cross-referencing of every claim in `ARCHITECTURE.md`, `ROADMAP.md`, `docs/EVENT_INDEXER.md`, `docs/AUTHENTICATION.md`, `docs/SECURITY.md`, and `docs/DATABASE.md` against the actual implementation — **27 issues met the required bar**: genuinely new, verified against real behavior (not speculation), non-duplicate against #1–#100, the then-published GitHub #9–#38, and each other, and contributor-ready at the same structural depth as the first pass. Several additional hypotheses were investigated and specifically ruled out after verification rather than filed speculatively (see below); rather than lower the quality bar or split the 27 into artificially narrower pieces to approach 50, this pass stops at the number actually substantiated, per the task's explicit instruction to do so.
- **Duplicate/false-lead check** — hypotheses investigated and rejected because verification disproved them or an existing issue (#1–#100 or the then-published GitHub #9–#38) already covers the same root cause:
  - "`jsonwebtoken` doesn't restrict verification algorithms, enabling an alg-confusion attack" — disproven: v9.0.3's `verify.js` defaults `options.algorithms` to the HMAC family whenever a plain secret (not a public key) is supplied, and explicitly rejects `alg: none` unless whitelisted.
  - "Swagger UI's assets are blocked by the strict global CSP" — disproven: `@fastify/swagger-ui@5.2.6`'s own `csp.json` declares no inline script/style requirement, and its `index.html` loads only same-origin `<script src>` tags, which `default-src 'self'` already permits.
  - "`docker-compose.yml`'s Postgres/Redis credentials are a security gap" — considered and set aside as an already-acknowledged, deliberate local-dev convenience with no production claim attached, not a genuine defect.
  - "`local-evidence-storage.ts`'s `read()` is vulnerable to path traversal" — disproven (re-confirmed): the `path.resolve` + `startsWith(resolvedBaseDir + path.sep)` guard correctly rejects both absolute and `..`-relative escapes, and the existing spec file already tests exactly this.
  - "The Grafana dashboard has fewer/more panels than `docs/OBSERVABILITY.md`'s stated seven" — disproven: direct count of the dashboard JSON confirms exactly seven panels, matching the documentation precisely.
  - "`docs/AUTHENTICATION.md`'s claim of real (non-mocked) ed25519 signature testing is inaccurate" — disproven: `stellar-signature-verifier.spec.ts` uses genuine `Keypair.random()` key generation and real `.sign()`/`.verify()` calls throughout, no mocking.
  - "The `.env.example`/env-schema key sets have drifted (25 vs 20 fields)" — disproven (consistent with the original backlog's own rejection of the same claim): both currently list the identical 25 keys.
  - Two additional single-class "dead code" candidates (`ValidationError` alone, `InternalError` alone) were merged into one combined issue (#126) rather than filed as two near-identical items, once both were confirmed unused by the same grep.
- **Referenced-path verification:** every file path, line range, and symbol cited above was confirmed to exist in the working tree at the time of writing (or, where a fix proposes a new file, is explicitly described as new).
- **#31–#100 confirmed untouched at the time:** no edit was made to any existing backlog entry during this pass; #101–#127 were a pure append. (All of #1–#127 have since been published to GitHub and removed from this file across three publishing rounds — see the table at the top of this document for current state.)
- **Scope discipline:** no GitHub issue was created, no commit was made, and no file other than this backlog was modified, per that pass's explicit instructions.
