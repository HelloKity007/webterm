#!/usr/bin/env bash
set -euo pipefail

# Kill orphaned tmux servers that hold sockets but no sessions. Each
# terminal runs its own isolated tmux server; when the session ends the
# server process and socket file are left behind. Run periodically (every
# 15 minutes via webterm-cleanup.timer) to keep process count and FDs
# bounded. Shared/legacy sockets are never touched.

OWNER="${WEBTERM_OWNER:-pgz}"
PROD_DIR="${WEBTERM_PROD_SOCK_DIR:-/home/$OWNER/.local/state/webterm/webterm-production}"
TEST_DIR="${WEBTERM_TEST_SOCK_DIR:-/home/$OWNER/.local/state/webterm/webterm-release-test}"
# Use the same pinned tmux binary that started the servers; the system tmux
# (3.5a) cannot connect to 3.7c servers and reports "server exited".
# tmux-production is a socket-pinned wrapper that refuses -S overrides.
TMUX_BIN="${WEBTERM_TMUX_BIN:-/home/$OWNER/.local/state/webterm/bin/tmux-3.7c}"
TMUX_TEST_BIN="${WEBTERM_TMUX_TEST_BIN:-/media/pgz/DATA-B/code/tools/webterm-xufanchn/webterm-HelloKity007/runtime/tmux-fixed/bin/tmux}"
# Sockets that must never be reaped: shared/legacy production socket and the
# fixed release-test socket used by the QA harness.
SKIP_PATTERNS=('webterm-production-durable' 'webterm-release-test-fixed' 'default')

killed=0
reap_dir() {
  local dir="$1" tmux="$2"
  [ -d "$dir" ] || return 0
  local socket
  for socket in "$dir"/*; do
    [ -e "$socket" ] || continue
    local base; base="$(basename "$socket")"
    local skip
    for skip in "${SKIP_PATTERNS[@]}"; do
      [ "$base" = "$skip" ] && continue 2
    done
    # Only reap sockets owned by the expected user and never symlinks.
    [ -L "$socket" ] && continue
    local sessions
    sessions="$("$tmux" -S "$socket" list-sessions 2>/dev/null | wc -l)" || sessions=0
    if [ "$sessions" -eq 0 ]; then
      "$tmux" -S "$socket" kill-server 2>/dev/null || true
      rm -f "$socket"
      killed=$((killed + 1))
    fi
  done
}

reap_dir "$PROD_DIR" "$TMUX_BIN"
reap_dir "$TEST_DIR" "$TMUX_TEST_BIN"

if [ "$killed" -gt 0 ]; then
  logger -t webterm-cleanup "reaped $killed orphaned tmux servers (no sessions)"
fi
echo "reaped=$killed"
