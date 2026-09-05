#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"

lan_check

[[ -x "$RELEASE_PREVIOUS_BINARY" ]] || lan_die "no previous production binary is available"
[[ -s "$RELEASE_PREVIOUS_VERSION" ]] || lan_die "previous production version is unknown"
previous_version="$(<"$RELEASE_PREVIOUS_VERSION")"
next_binary="$RELEASE_PRODUCTION_DIR/webterm.rollback"
cp "$RELEASE_PREVIOUS_BINARY" "$next_binary"
chmod 700 "$next_binary"
lan_stop_pid webterm
mv "$next_binary" "$LAN_BINARY"
lan_start_production
release_wait_status_ok "http://127.0.0.1:8888/api/health" || lan_die "rolled-back production did not become healthy"
printf '%s\n' "$previous_version" >"$RELEASE_DEPLOYED_SHA"
echo "production rolled back: $previous_version"
