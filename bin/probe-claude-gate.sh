#!/usr/bin/env bash
# Branch-local V-372 probe: isolated install + real-Git private binding.
#
# Installs this checkout into a throwaway CLAUDE_CONFIG_DIR with --copy, then
# exercises the copied ticket-worktree helper against a disposable managed
# worktree. HOME is also redirected into scratch, so the probe cannot mutate the
# live ~/.claude tree.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
mkdir -p "$ROOT/tmp"
BOX="$(mktemp -d "$ROOT/tmp/probe-claude-gate.XXXXXX")"
trap 'rm -rf "$BOX"' EXIT

export HOME="$BOX/home"
export CLAUDE_CONFIG_DIR="$BOX/claude-config"
mkdir -p "$HOME"

CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" HOME="$HOME" \
  bash "$ROOT/install.sh" --copy >/dev/null

HELPER="$CLAUDE_CONFIG_DIR/bin/ticket-worktree.mjs"
SETTINGS="$CLAUDE_CONFIG_DIR/settings.json"
[ -f "$HELPER" ] && [ ! -L "$HELPER" ] || {
  echo "FAIL: isolated --copy install did not copy ticket-worktree.mjs"
  exit 1
}
[ -f "$SETTINGS" ] || {
  echo "FAIL: isolated install did not seed settings.json"
  exit 1
}
if grep -q 'active-project\.json' "$SETTINGS"; then
  echo "FAIL: isolated settings retain the obsolete protected-marker Write rule"
  exit 1
fi

REPO="$BOX/repo"
git init -q -b main "$REPO"
git -C "$REPO" config user.email t@t.test
git -C "$REPO" config user.name test
printf 'seed\n' > "$REPO/seed.txt"
git -C "$REPO" add seed.txt
git -C "$REPO" commit -qm seed

LAYOUT="$(HOME="$HOME" node "$HELPER" resolve --root "$REPO" --mode standalone --issue V-372)"
WT="$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.preferredPath)' "$LAYOUT")"
EXPECTED="$REPO/.claude/worktrees/repo-wt-v-372"
[ "$WT" = "$EXPECTED" ] || {
  echo "FAIL: ordinary repo did not resolve to managed worktree path: $WT"
  exit 1
}

node "$HELPER" prepare-parent --path "$WT" >/dev/null
git -C "$REPO" worktree add -q -b probe-v-372 "$WT" main
node "$HELPER" write-binding --worktree "$WT" --json '{"mode":"standalone","linearIssue":"V-372"}' >/dev/null

BINDING="$(node "$HELPER" binding-path --worktree "$WT")"
EXPECTED_BINDING="$(git -C "$WT" rev-parse --path-format=absolute --git-path claude-ticket-flow.json)"
[ "$BINDING" = "$EXPECTED_BINDING" ] && [ -f "$BINDING" ] || {
  echo "FAIL: binding was not written to the linked worktree private Git path"
  exit 1
}
case "$BINDING" in
  "$WT/.claude/"*)
    echo "FAIL: binding leaked into the protected checkout .claude tree"
    exit 1
    ;;
esac
[ ! -e "$WT/.claude/active-project.json" ] || {
  echo "FAIL: obsolete protected binding marker was created"
  exit 1
}
[ "$(node "$HELPER" binding-status --worktree "$WT")" = "private" ] || {
  echo "FAIL: helper did not report private binding state"
  exit 1
}
READ_BACK="$(node "$HELPER" read-binding --worktree "$WT")"
node -e 'const value=JSON.parse(process.argv[1]); if (value.mode !== "standalone" || value.linearIssue !== "V-372") process.exit(1)' "$READ_BACK" || {
  echo "FAIL: private binding payload did not round-trip"
  exit 1
}

echo "PASS: isolated branch install uses managed real-Git worktree binding without touching protected markers"
