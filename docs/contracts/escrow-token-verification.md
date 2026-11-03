# Escrow token verification

`Escrow.isVerified` records acceptance by the token policy when `escrow_funded`
is ingested. It is off-chain state, separate from `User.emailVerifiedAt`, wallet
signature verification and driver KYC. It is not a transaction authorization
credential. The chain reader cannot supply the local allowlist decision.

The introducing change (`7ebc2b5`, issue #383) persisted the decision and filtered
released GMV by it. The schema field and repository write were lost in merge
`5c96b86`; the policy, domain field and analytics predicate survived. No historical
migration added `is_verified`. Restore the persisted contract rather than remove
the GMV restriction or derive historical acceptance from today's configuration.

New ingestion keeps the existing policy: a configured allowlist decides membership;
without one, the existing compatibility policy accepts tokens. This repair does
not change that configuration policy. Repository callers without a decision and
rows predating the migration default to false. False means acceptance has not
been established, including unknown historical state. Only explicit true enters
released GMV. Status updates retain the stored decision. Changing the allowlist
does not retroactively reclassify stored rows.

No reliable historical allowlist snapshots or per-row decisions are available.
The additive migration therefore excludes historical rows from GMV; it does not
infer truth from token names, release status, email or wallet timestamps. Any
future historical reclassification needs separately reviewed reliable evidence.
The public escrow DTO continues to omit this internal flag. Authentication,
role restrictions, email verification and wallet verification are unchanged.

Before rollout, inspect redacted target migration history and catalog. Apply the
new migration through the approved process before starting a matching generated
Prisma client/binary. An unexpected existing column is schema drift requiring
investigation, not a reason to replay or overwrite its values. Preserve all
applied migrations and stored decisions during recovery. Fresh replay currently
fails earlier at the duplicate analytics index; a component upgrade test does
not certify the full chain or a representative deployment upgrade.
