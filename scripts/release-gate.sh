#!/usr/bin/env bash
set -euo pipefail

# One-command release gate. Static stages (frontend tests/lint/build, Go
# test/vet) plus a read-only browser smoke against the release-test
# deployment on 9444. Intended to block release-deploy/approve on failure.
#   BROWSER_ONLY=1  skip static stages (deploy script already ran them)
#   SKIP_BROWSER=1  skip the browser stage (no candidate running yet)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"
release_require_command node
release_require_command npm
release_require_command go

if [[ "${BROWSER_ONLY:-0}" != "1" ]]; then
  npm --prefix "$LAN_ROOT/ui" test -- --run
  npm --prefix "$LAN_ROOT/ui" run lint
  npm --prefix "$LAN_ROOT/ui" run build
  go -C "$LAN_ROOT" test ./...
  go -C "$LAN_ROOT" vet ./...
fi

if [[ "${SKIP_BROWSER:-0}" == "1" ]]; then
  echo "release gate: browser stage skipped (SKIP_BROWSER=1)"
  exit 0
fi

health="$(curl --silent --max-time 5 http://127.0.0.1:8889/api/health || true)"
[[ "$health" == *'"environment":"release-test"'* ]] || lan_die "release gate requires a healthy release-test on 127.0.0.1:8889"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
WEBTERM_QA_OUTPUT="$LAN_RUNTIME_DIR/release-gate/$stamp" node "$SCRIPT_DIR/verify-release-gate.mjs" || lan_die "release gate browser stage failed (evidence: runtime/release-gate/$stamp)"
echo "release gate: PASS (evidence: runtime/release-gate/$stamp)"
