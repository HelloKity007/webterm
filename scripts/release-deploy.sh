#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/release-lib.sh"

lan_check
release_require_command curl
release_require_command git
release_require_command go
release_require_command npm
release_require_command sqlite3

[[ -z "$(git -C "$LAN_ROOT" status --porcelain)" ]] || lan_die "release candidates must be built from a clean worktree"
branch="$(git -C "$LAN_ROOT" branch --show-current)"
[[ "$branch" == dev-* ]] || lan_die "release candidates must be built from a dev-* branch (current: $branch)"
candidate="$(git -C "$LAN_ROOT" rev-parse HEAD)"

npm --prefix "$LAN_ROOT/ui" test -- --run
npm --prefix "$LAN_ROOT/ui" run lint
npm --prefix "$LAN_ROOT/ui" run build
go -C "$LAN_ROOT" test ./...

mkdir -p "$LAN_RELEASE_DIR"
next_binary="$LAN_RELEASE_DIR/webterm.next"
next_database="$LAN_RELEASE_DIR/webterm.db.next"
go -C "$LAN_ROOT" build -ldflags "-X main.version=$candidate" -o "$next_binary" .

lan_stop_pid webterm-release
rm -f "$next_database"
sqlite3 "$LAN_ROOT/webterm.db" ".backup '$next_database'"
chmod 600 "$next_database"
mv "$next_binary" "$LAN_RELEASE_BINARY"
mv "$next_database" "$LAN_RELEASE_DATABASE"
printf '%s\n' "$candidate" >"$RELEASE_CANDIDATE_SHA"
printf '%s\n' "$branch" >"$RELEASE_CANDIDATE_BRANCH"
rm -f "$RELEASE_APPROVED_SHA"

lan_start_release
release_wait_health "http://127.0.0.1:8889/api/health" release-test "$candidate" || lan_die "release-test failed its versioned health check"
public_health="$(curl --silent --show-error --insecure --interface "$LAN_PUBLIC_IP" "https://$LAN_PUBLIC_IP:9444/api/health")"
[[ "$public_health" == *"\"version\":\"$candidate\""* ]] || lan_die "release-test public endpoint is not serving the candidate; reload Caddy"
echo "release candidate deployed: $candidate"
echo "release test URL: https://$LAN_PUBLIC_IP:9444/"
