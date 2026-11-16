#!/usr/bin/env bash
# orca.yaml から呼ぶ入口。Orca の hook は対話 shell の初期化を通らないことがあるため、
# node が PATH に無ければ mise / Homebrew の場所を補ってから Node 実装へ渡す。
set -euo pipefail
action="${1:?usage: hook.sh setup|archive}"
cd "$(dirname "$0")/../.."
if ! command -v node >/dev/null 2>&1; then
  for dir in "$HOME/.local/share/mise/shims" /opt/homebrew/bin /usr/local/bin; do
    [ -x "$dir/node" ] && PATH="$dir:$PATH" && break
  done
fi
command -v node >/dev/null 2>&1 || { echo "[worktree] node が見つかりません (>=22 が必要)" >&2; exit 1; }
exec node "scripts/worktree/$action.mjs"
