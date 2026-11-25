#!/usr/bin/env bash
# Verifies that the shared stages (base, deps, build, prod-deps) in
# Dockerfile and Dockerfile.worker are identical.
#
# Run via `make check-dockerfile-parity` or directly in CI to prevent silent
# drift between the two build entrypoints. Any edit to a shared stage must be
# applied to both files; this script fails fast if that is not the case.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

extract_shared_stages() {
  local file="$1"
  # Skip leading comment/blank lines, then extract everything up to (but not
  # including) the first final-image stage. Final stages start with
  # "# ── api:" or "# ── worker:".
  awk '
    /^FROM / { in_stages=1 }
    in_stages && /^# ── (api|worker):/ { exit }
    in_stages { print }
  ' "$file"
}

MAIN=$(extract_shared_stages "$REPO_ROOT/Dockerfile")
WORKER=$(extract_shared_stages "$REPO_ROOT/Dockerfile.worker")

if [ "$MAIN" = "$WORKER" ]; then
  echo "✓ Dockerfile shared stages are in sync."
  exit 0
else
  echo "✗ Dockerfile and Dockerfile.worker shared stages have drifted!"
  echo "  Edit shared stages in BOTH files, or regenerate with 'make sync-dockerfiles'."
  diff <(echo "$MAIN") <(echo "$WORKER") || true
  exit 1
fi
