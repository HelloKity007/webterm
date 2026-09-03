#!/usr/bin/env bash

set -euo pipefail

LAN_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAN_ROOT="${WEBTERM_ROOT:-$(cd "$LAN_SCRIPT_DIR/.." && pwd)}"
LAN_RUNTIME_DIR="$LAN_ROOT/runtime"
LAN_CONFIG="$LAN_ROOT/config.yaml"
LAN_SECRETS="$LAN_ROOT/lan-secrets.env"
LAN_CADDYFILE="$LAN_ROOT/Caddyfile"
LAN_BINARY="$LAN_ROOT/webterm"
LAN_CADDY_BIN="${CADDY_BIN:-caddy}"

lan_die() {
  echo "lan deployment: $*" >&2
  exit 1
}

lan_require_mode_600() {
  local path="$1"
  [[ -f "$path" ]] || lan_die "missing required file: $path"
  local mode
  mode="$(stat -c '%a' "$path")"
  [[ "$mode" == "600" ]] || lan_die "$(basename "$path") must have permissions 600 (got $mode)"
}

lan_check() {
  lan_require_mode_600 "$LAN_CONFIG"
  lan_require_mode_600 "$LAN_SECRETS"
  [[ -f "$LAN_CADDYFILE" ]] || lan_die "missing required file: $LAN_CADDYFILE"
  lan_load_secrets
  command -v "$LAN_CADDY_BIN" >/dev/null 2>&1 || lan_die "caddy executable not found: $LAN_CADDY_BIN"
  "$LAN_CADDY_BIN" validate --config "$LAN_CADDYFILE" --adapter caddyfile >/dev/null
}

lan_load_secrets() {
  set -a
  # shellcheck disable=SC1090
  source "$LAN_SECRETS"
  set +a
  [[ -n "${WEBTERM_LOCAL_SSH_PASSWORD:-}" ]] || lan_die "WEBTERM_LOCAL_SSH_PASSWORD is not set in lan-secrets.env"
  [[ -n "${LAN_TLS_CERT:-}" && -f "$LAN_TLS_CERT" ]] || lan_die "LAN_TLS_CERT must point to an existing certificate"
  [[ -n "${LAN_TLS_KEY:-}" && -f "$LAN_TLS_KEY" ]] || lan_die "LAN_TLS_KEY must point to an existing private key"
}

lan_start() {
  lan_check
  [[ -x "$LAN_BINARY" ]] || lan_die "missing executable binary: $LAN_BINARY (run make build first)"
  mkdir -p "$LAN_RUNTIME_DIR"

  if [[ -f "$LAN_RUNTIME_DIR/webterm.pid" ]] && kill -0 "$(<"$LAN_RUNTIME_DIR/webterm.pid")" 2>/dev/null; then
    lan_die "webterm is already running"
  fi
  if [[ -f "$LAN_RUNTIME_DIR/caddy.pid" ]] && kill -0 "$(<"$LAN_RUNTIME_DIR/caddy.pid")" 2>/dev/null; then
    lan_die "caddy is already running"
  fi

  (
    cd "$LAN_ROOT"
    setsid "$LAN_BINARY" -config "$LAN_CONFIG" >"$LAN_RUNTIME_DIR/webterm.log" 2>&1 &
    echo $! >"$LAN_RUNTIME_DIR/webterm.pid"
    setsid "$LAN_CADDY_BIN" run --config "$LAN_CADDYFILE" --adapter caddyfile >"$LAN_RUNTIME_DIR/caddy.log" 2>&1 &
    echo $! >"$LAN_RUNTIME_DIR/caddy.pid"
  )
}

lan_stop_pid() {
  local name="$1"
  local pidfile="$LAN_RUNTIME_DIR/$name.pid"
  [[ -f "$pidfile" ]] || return 0
  local pid
  pid="$(<"$pidfile")"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid"
  fi
  rm -f "$pidfile"
}

lan_stop() {
  lan_stop_pid caddy
  lan_stop_pid webterm
}

lan_status() {
  for name in webterm caddy; do
    local pidfile="$LAN_RUNTIME_DIR/$name.pid"
    if [[ -f "$pidfile" ]] && kill -0 "$(<"$pidfile")" 2>/dev/null; then
      echo "$name: running (pid $(<"$pidfile"))"
    else
      echo "$name: stopped"
    fi
  done
}
