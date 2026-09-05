#!/usr/bin/env bash

set -euo pipefail

RELEASE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$RELEASE_SCRIPT_DIR/lan-lib.sh"

RELEASE_CANDIDATE_SHA="$LAN_RELEASE_DIR/candidate.sha"
RELEASE_CANDIDATE_BRANCH="$LAN_RELEASE_DIR/candidate.branch"
RELEASE_APPROVED_SHA="$LAN_RELEASE_DIR/approved.sha"
RELEASE_PRODUCTION_DIR="$LAN_RUNTIME_DIR/production"
RELEASE_PREVIOUS_BINARY="$RELEASE_PRODUCTION_DIR/webterm.previous"
RELEASE_PREVIOUS_VERSION="$RELEASE_PRODUCTION_DIR/previous.version"
RELEASE_DEPLOYED_SHA="$RELEASE_PRODUCTION_DIR/deployed.sha"

release_require_command() {
  command -v "$1" >/dev/null 2>&1 || lan_die "required command not found: $1"
}

release_wait_health() {
  local url="$1"
  local expected_environment="$2"
  local expected_version="$3"
  local deadline=$((SECONDS + 20))
  local body=""
  while (( SECONDS < deadline )); do
    body="$(curl --silent --show-error "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"status":"ok"'* && "$body" == *"\"environment\":\"$expected_environment\""* && "$body" == *"\"version\":\"$expected_version\""* ]]; then
      return 0
    fi
    sleep 1
  done
  echo "health check failed for $url (last response: $body)" >&2
  return 1
}

release_wait_status_ok() {
  local url="$1"
  local deadline=$((SECONDS + 20))
  local body=""
  while (( SECONDS < deadline )); do
    body="$(curl --silent --show-error "$url" 2>/dev/null || true)"
    if [[ "$body" == *'"status":"ok"'* ]]; then
      return 0
    fi
    sleep 1
  done
  echo "status check failed for $url (last response: $body)" >&2
  return 1
}

release_candidate_sha() {
  [[ -s "$RELEASE_CANDIDATE_SHA" ]] || lan_die "no deployed release candidate"
  local candidate
  IFS= read -r candidate <"$RELEASE_CANDIDATE_SHA"
  printf '%s\n' "$candidate"
}

release_exact_rb_ref() {
  local candidate="$1"
  git -C "$LAN_ROOT" for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/rb-*' 'refs/remotes/origin/rb-*' |
    awk -v sha="$candidate" '$2 == sha { print $1; exit }'
}
