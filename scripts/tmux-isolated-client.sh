#!/usr/bin/env bash
# Install a rendered copy on each SSH host. Never point legacy live servers at
# a different client version. This wrapper is for isolated new servers only.
set -euo pipefail
TMUX_ISOLATED_BINARY='@BINARY@'
TMUX_ISOLATED_DIRECTORY='@DIRECTORY@'
TMUX_CORE_DIRECTORY='@CORE_DIRECTORY@'
# Linux bash ulimit uses KiB: at most 256 MiB per server dump.
TMUX_CORE_LIMIT_KIB=262144
args=("$@")
socket=''
creating=false
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[i]}" == '-S' ]]; then socket="${args[i+1]:-}"; fi
  if [[ "${args[i]}" == 'new-session' ]]; then creating=true; fi
done
if [[ "$creating" == true ]]; then
  [[ "${socket%/*}" == "$TMUX_ISOLATED_DIRECTORY" && "${socket##*/}" =~ ^[0-9a-f]{32}$ ]] || { echo 'invalid isolated creation socket' >&2; exit 64; }
  [[ "$TMUX_CORE_DIRECTORY" == /* && "$TMUX_CORE_DIRECTORY" != *'@'* ]] || exit 64
  umask 077
  mkdir -p "$TMUX_CORE_DIRECTORY"
  [[ ! -L "$TMUX_CORE_DIRECTORY" && "$(stat -c %u "$TMUX_CORE_DIRECTORY")" == "$(id -u)" && "$(stat -c %a "$TMUX_CORE_DIRECTORY")" == 700 ]] || exit 64
  crash_dir="$TMUX_CORE_DIRECTORY/${socket##*/}"
  mkdir -p "$crash_dir"
  [[ ! -L "$crash_dir" && "$(stat -c %u "$crash_dir")" == "$(id -u)" && "$(stat -c %a "$crash_dir")" == 700 ]] || exit 64
  cd "$crash_dir"
  ulimit -c "$TMUX_CORE_LIMIT_KIB"
  # Preserve the normal SSH home-directory starting point for the shell even
  # though the server's cwd is a unique location for relative core_pattern.
  for ((i=0; i<${#args[@]}; i++)); do
    if [[ "${args[i]}" == 'new-session' ]]; then
      args=("${args[@]:0:i+1}" '-c' "$HOME" "${args[@]:i+1}")
      break
    fi
  done
  "$TMUX_ISOLATED_BINARY" -V > binary-version.txt
  sha256sum "$TMUX_ISOLATED_BINARY" > binary-sha256.txt
  cat /proc/sys/kernel/core_pattern > core-pattern.txt
fi
exec "$TMUX_ISOLATED_BINARY" "${args[@]}"
