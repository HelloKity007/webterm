#!/usr/bin/env bash
set -euo pipefail

# Remove QA evidence directories older than the retention window. The
# runtime tree holds browser recordings, screenshots and diagnostic JSON
# that accumulates across verification rounds; keeping a week is enough for
# incident review while reclaiming gigabytes of disk.

RUNTIME_DIR="${WEBTERM_RUNTIME_DIR:-/media/pgz/DATA-B/code/tools/webterm-xufanchn/webterm-HelloKity007/runtime}"
RETENTION_DAYS="${WEBTERM_RUNTIME_RETENTION_DAYS:-7}"

[ -d "$RUNTIME_DIR" ] || exit 0
removed=0
freed=0

# Preserve the release-gate evidence directory (keep the newest 5 runs) and
# the release deployment directory itself.
preserve_name() {
  case "$1" in
    release|release-gate|tmux-fixed|production|wheel-diag-20261010) return 0 ;;
  esac
  return 1
}

for dir in "$RUNTIME_DIR"/*/; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  preserve_name "$name" && continue
  # Delete directories not modified within the retention window.
  if [ -n "$(find "$dir" -maxdepth 0 -mtime "+$RETENTION_DAYS" 2>/dev/null)" ]; then
    size="$(du -sh "$dir" 2>/dev/null | cut -f1)"
    rm -rf "$dir"
    removed=$((removed + 1))
    echo "removed: $name ($size)"
  fi
done

# Keep only the newest 5 release-gate runs.
GATE_DIR="$RUNTIME_DIR/release-gate"
if [ -d "$GATE_DIR" ]; then
  mapfile -t gates < <(ls -1t "$GATE_DIR" 2>/dev/null | tail -n +6)
  for g in "${gates[@]:-}"; do
    [ -n "$g" ] && rm -rf "$GATE_DIR/$g" && echo "removed gate run: $g"
  done
fi

echo "removed=$removed"
