#!/usr/bin/env bash
set -euo pipefail

# Production health watchdog. Runs from webterm-watchdog.timer every 30s:
# three consecutive failures of the local 8888 health check restore the
# previous production binary and restart webterm-lan exactly once. A
# rollback lock prevents loops; clear it (and refresh the previous binary)
# before the next promote. Stop the timer during intentional maintenance.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"

STATE_FILE="$RELEASE_PRODUCTION_DIR/watchdog-failures"
LOCK_FILE="$RELEASE_PRODUCTION_DIR/rollback.lock"
MAX_FAILURES=3

body="$(curl --silent --max-time 5 http://127.0.0.1:8888/api/health || true)"
if [[ "$body" == *'"status":"ok"'* ]]; then
  printf '0\n' >"$STATE_FILE"
  rm -f "$LOCK_FILE"
  exit 0
fi

failures=$(( $(<"$STATE_FILE" 2>/dev/null || echo 0) + 1 ))
printf '%s\n' "$failures" >"$STATE_FILE"
if (( failures < MAX_FAILURES )); then
  exit 0
fi
if [[ -f "$LOCK_FILE" ]]; then
  logger -t webterm-watchdog "production still unhealthy after rollback; manual intervention required (last body: ${body:0:120})"
  exit 0
fi
touch "$LOCK_FILE"
if [[ ! -x "$RELEASE_PREVIOUS_BINARY" ]]; then
  logger -t webterm-watchdog "health failing and no previous binary to roll back to"
  exit 0
fi
previous_version="$(<"$RELEASE_PREVIOUS_VERSION" 2>/dev/null || echo unknown)"
systemctl stop webterm-lan
cp "$RELEASE_PREVIOUS_BINARY" "$LAN_BINARY"
chmod 700 "$LAN_BINARY"
systemctl start webterm-lan
sleep 2
systemctl is-active --quiet webterm-lan-caddy || systemctl start webterm-lan-caddy
logger -t webterm-watchdog "rolled production back to $previous_version after $failures failed health checks"
