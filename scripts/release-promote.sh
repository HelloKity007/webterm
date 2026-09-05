#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"

# Production needs the encryption and local SSH environment just like the
# release-test process. Validate the deployment inputs and export secrets before
# stopping the currently healthy process.
lan_check

candidate="$(release_candidate_sha)"
[[ -s "$RELEASE_APPROVED_SHA" ]] || lan_die "candidate has not been approved"
approved="$(<"$RELEASE_APPROVED_SHA")"
[[ "$approved" == "$candidate" ]] || lan_die "approval does not match the current candidate"
release_ref="$(release_exact_rb_ref "$candidate")"
[[ -n "$release_ref" ]] || lan_die "candidate must be the exact tip of an rb-* release branch before production promotion"

release_wait_health "http://127.0.0.1:8889/api/health" release-test "$candidate" || lan_die "approved release-test candidate is not healthy"
mkdir -p "$RELEASE_PRODUCTION_DIR"
next_binary="$RELEASE_PRODUCTION_DIR/webterm.next"
cp "$LAN_RELEASE_BINARY" "$next_binary"
chmod 700 "$next_binary"
if [[ -x "$LAN_BINARY" ]]; then
  cp "$LAN_BINARY" "$RELEASE_PREVIOUS_BINARY"
  "$LAN_BINARY" -version | awk '{print $2}' >"$RELEASE_PREVIOUS_VERSION"
fi

lan_stop_pid webterm
mv "$next_binary" "$LAN_BINARY"
lan_start_production
if ! release_wait_health "http://127.0.0.1:8888/api/health" production "$candidate"; then
  echo "candidate failed production health; restoring previous binary" >&2
  lan_stop_pid webterm
  cp "$RELEASE_PREVIOUS_BINARY" "$LAN_BINARY"
  chmod 700 "$LAN_BINARY"
  lan_start_production
  release_wait_status_ok "http://127.0.0.1:8888/api/health" || lan_die "candidate and automatic production rollback both failed"
  lan_die "candidate failed production health and was rolled back"
fi
printf '%s\n' "$candidate" >"$RELEASE_DEPLOYED_SHA"
echo "production promoted from $release_ref: $candidate"
