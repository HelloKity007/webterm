#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"

lan_status
for item in candidate approved deployed; do
  path="$LAN_RELEASE_DIR/$item.sha"
  [[ "$item" == deployed ]] && path="$RELEASE_DEPLOYED_SHA"
  if [[ -s "$path" ]]; then
    echo "$item: $(<"$path")"
  else
    echo "$item: none"
  fi
done
