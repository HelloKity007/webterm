#!/usr/bin/env bash
# Configure these three values in the installed copy, not in remote shell env.
set -euo pipefail
TMUX_DURABLE_BINARY='@BINARY@'
TMUX_DURABLE_SOCKET='@SOCKET@'
TMUX_DURABLE_NAMESPACE='webterm-production-durable'
args=()
while (($#)); do
  case "$1" in
    -L)
      [[ $# -ge 2 && "$2" == "$TMUX_DURABLE_NAMESPACE" ]] || { echo 'unexpected tmux namespace' >&2; exit 64; }
      shift 2 ;;
    -S) echo 'socket override is not permitted' >&2; exit 64 ;;
    -N|-C|-CC|-u|-v|-vv|-V) args+=("$1"); shift ;;
    *) args+=("$@"); break ;;
  esac
done
exec "$TMUX_DURABLE_BINARY" -S "$TMUX_DURABLE_SOCKET" "${args[@]}"
