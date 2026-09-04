#!/usr/bin/env bash
set -euo pipefail

: "${WEBTERM_BASE_URL:?set WEBTERM_BASE_URL}"
: "${WEBTERM_LOADTEST_USERNAME:?set WEBTERM_LOADTEST_USERNAME}"
: "${WEBTERM_LOADTEST_PASSWORD:?set WEBTERM_LOADTEST_PASSWORD}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$SCRIPT_DIR/verify-persistent-terminal.mjs"
