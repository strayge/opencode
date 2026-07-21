#!/bin/sh
# build-custom.sh — build this fork with a real version string, without editing
# any upstream source.
#
# `Script.version` returns $OPENCODE_VERSION verbatim when it is set, so exporting
# it here bakes a meaningful value into the compiled binary. Without it a
# non-"latest" channel reports 0.0.0-<channel>-<buildnumber>. The version is the
# in-tree opencode package version plus the short commit, e.g.:
#
#     opencode2 --version  ->  1.18.3+custom.207fd68
#
# OPENCODE_CHANNEL is pinned so Script.channel does not infer "latest" from the
# non-"0.0.0-" version — inferring "latest" would switch the sqlite database to
# opencode.db and turn on release-channel behavior.
#
# Reading the base from packages/opencode/package.json means this tracks upstream
# version bumps across rebases with no edits.
#
# Usage:
#     ./build-custom.sh            # build (single target, current platform)
#     ./build-custom.sh --install  # build, then install to ~/.local/bin
#
# Builds a single target by default; --single is injected when absent. Invoke
# build.ts directly (without this wrapper) to build every target. --install is
# consumed here; every other argument is forwarded to build.ts.
set -eu

repo="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$repo"

# Split --install out of the forwarded build arguments (order preserved), and
# note whether the caller already asked for --single.
install=0
has_single=0
n=$#
while [ "$n" -gt 0 ]; do
  a="$1"
  shift
  case "$a" in
    --install) install=1 ;;
    --single) has_single=1; set -- "$@" "$a" ;;
    *) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done

# Default to a single-target build for the current platform.
if [ "$has_single" -eq 0 ]; then
  set -- --single "$@"
fi

base="$(bun -e "console.log(require('./packages/opencode/package.json').version)")"
sha="$(git rev-parse --short HEAD)"
# Distinguish an ad-hoc build off a dirty tree from a clean commit.
if ! git diff --quiet HEAD 2>/dev/null; then
  sha="$sha.dirty"
fi

export OPENCODE_VERSION="$base+custom.$sha"
export OPENCODE_CHANNEL=custom

echo "building opencode2 $OPENCODE_VERSION (channel $OPENCODE_CHANNEL)" >&2
bun run ./packages/cli/script/build.ts "$@"

if [ "$install" -eq 1 ]; then
  # --single produces exactly one target under packages/cli/dist; locate its bin
  # rather than assume a target-specific directory name.
  outdir="$repo/packages/cli/dist"
  bin="$(find "$outdir" -type f -path '*/bin/opencode2' 2>/dev/null | head -1)"
  if [ -z "$bin" ]; then
    bin="$(find "$outdir" -type f -path '*/bin/*' 2>/dev/null | head -1)"
  fi
  if [ -z "$bin" ]; then
    echo "install: no built binary found under $outdir" >&2
    exit 1
  fi
  dest="$HOME/.local/bin/opencode2"
  mkdir -p "$HOME/.local/bin"
  # Stage then rename so replacing a currently-running opencode2 does not fail
  # with ETXTBSY — the rename swaps the path, leaving the live process's inode.
  tmp="$dest.new.$$"
  cp "$bin" "$tmp"
  chmod +x "$tmp"
  mv -f "$tmp" "$dest"
  echo "installed $bin -> $dest" >&2
fi
