#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"

candidate="$(release_candidate_sha)"
release_wait_health "http://127.0.0.1:8889/api/health" release-test "$candidate" || lan_die "release-test candidate is not healthy"
printf '%s\n' "$candidate" >"$RELEASE_APPROVED_SHA"
echo "release candidate approved: $candidate"
