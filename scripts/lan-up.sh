#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lan-lib.sh"

case "${1:-up}" in
  check) lan_check ;;
  up) lan_start ;;
  *) echo "usage: $0 [check|up]" >&2; exit 2 ;;
esac
