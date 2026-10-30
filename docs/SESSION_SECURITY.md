# Session revocation policy

Each new login creates an independent persisted refresh-token family. Rotation locks the user row and commits token consumption and successor insertion together. A cryptographically valid, unexpired token whose persisted row is already revoked is a reuse signal: the whole family is revoked, including any successor committed by a concurrent rotation. There is no retry grace window. Clients must serialize refresh requests; concurrent reuse may invalidate the winning response too. Unknown/mismatched/expired tokens do not revoke unrelated sessions.

Family revocation affects refresh capability. Already issued access JWTs remain usable until their normal expiry; this change does not claim family-scoped immediate access revocation. Password reset and administrator role changes invalidate access through the user token version.

Historical refresh-token ancestry is unknown. The additive migration leaves historical family IDs null and revokes historical refresh tokens. Users must log in again; existing access tokens retain their previous expiry/version behavior. Do not backfill guessed families. During deployment quiesce old application instances before migrating and restart only upgraded instances: old binaries do not enforce family revocation. Retain revoked token rows for replay detection through their JWT expiry. No cleanup is part of this change.
