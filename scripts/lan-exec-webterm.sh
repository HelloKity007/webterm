#!/usr/bin/env bash
set -euo pipefail

# Foreground launcher for the systemd unit: reuses the same preflight checks
# as lan-up.sh (config/secrets permissions, TLS material, tmux pin validation)
# so boot-start and manual start behave identically.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lan-lib.sh"

lan_check
lan_preflight_production_binary "$LAN_BINARY"

start_args=(-config "$LAN_CONFIG")
if [[ -n "${WEBTERM_PRODUCTION_TMUX_BINARY:-}" ]]; then
  start_args+=(-tmux-binary "$WEBTERM_PRODUCTION_TMUX_BINARY" -tmux-socket "$WEBTERM_PRODUCTION_TMUX_SOCKET")
fi
if [[ -n "${WEBTERM_PRODUCTION_SESSION_DIRECTORY:-}" || -n "${WEBTERM_PRODUCTION_SESSION_BINARY:-}" ]]; then
  start_args+=(-tmux-session-directory "$WEBTERM_PRODUCTION_SESSION_DIRECTORY" -tmux-session-binary "$WEBTERM_PRODUCTION_SESSION_BINARY")
fi
if "$LAN_BINARY" -help 2>&1 | grep -q -- "-database"; then
  start_args+=(-database "$LAN_ROOT/webterm.db" -environment production)
fi

exec "$LAN_BINARY" "${start_args[@]}"
