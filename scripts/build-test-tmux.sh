#!/usr/bin/env bash
set -euo pipefail
test_root="$(cd "$(dirname "$0")/.." && pwd)"
test_prefix="$test_root/runtime/tmux-fixed"
if [[ -x "$test_prefix/bin/tmux" ]]; then
  [[ "$("$test_prefix/bin/tmux" -V)" == 'tmux 3.7c' ]] || { echo 'Unexpected existing binary; refusing overwrite' >&2; exit 1; }
  exit 0
fi
mkdir -p "$test_root/runtime"
build_dir="$(mktemp -d "$test_root/runtime/tmux-build-XXXXXX")"
curl --fail --location https://github.com/tmux/tmux/releases/download/3.7c/tmux-3.7c.tar.gz -o "$build_dir/tmux.tar.gz"
echo "7c60cae9a0e25288e2e24750aafc9e8800fc7fd4555e447e1b29ee4201cfb3bf  $build_dir/tmux.tar.gz" | sha256sum --check
tar -xzf "$build_dir/tmux.tar.gz" -C "$build_dir"
cd "$build_dir/tmux-3.7c"
./configure --prefix="$test_prefix"
make -j4
make install
"$test_prefix/bin/tmux" -V
# Keep source/build evidence. Never replace /usr/bin/tmux or restart any server.
