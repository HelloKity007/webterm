#!/usr/bin/env bash
# Read-only diagnostic collection. Does not attach, create, signal or restart.
# Usage: bash scripts/collect-terminal-incident.sh BINARY ABSOLUTE_SOCKET OUTPUT_DIR
set -euo pipefail
[[ $# == 3 && "$1" == /* && "$2" == /* ]] || { echo 'usage: BINARY ABSOLUTE_SOCKET OUTPUT_DIR' >&2; exit 64; }
incident_binary="$1"
incident_socket="$2"
incident_output="$3"
umask 077
mkdir "$incident_output"
date -u +%FT%TZ > "$incident_output/observed-at.txt"
"$incident_binary" -V > "$incident_output/client-version.txt" 2>&1 || true
sha256sum "$incident_binary" > "$incident_output/client-sha256.txt"
stat "$incident_socket" > "$incident_output/socket.txt" 2>&1 || true
ss -xlpn > "$incident_output/unix-listeners.txt"
ps -eo pid,ppid,lstart,stat,comm > "$incident_output/processes.txt"
cat /proc/sys/kernel/core_pattern > "$incident_output/core-pattern.txt"
timeout 5 "$incident_binary" -N -S "$incident_socket" list-panes -a -F '#{pid}\t#{session_name}\t#{session_id}\t#{pane_id}\t#{pane_pid}\t#{@webterm_incarnation}' > "$incident_output/identity.txt" 2>&1 || true
journalctl -k --since '24 hours ago' --no-pager --grep='tmux.*segfault|Out of memory|Killed process' > "$incident_output/kernel.txt" 2>&1 || true
printf 'Evidence saved: %s\n' "$incident_output"
