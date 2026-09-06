#!/bin/sh
# Tests for worktree-remove.sh — regenerable-artefact clearing (V-527) and the
# load-bearing safety property it must not weaken. Hermetic: throwaway repo +
# worktrees under mktemp, never a real project worktree.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$DIR/worktree-remove.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

REPO="$TMP/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email test@example.com
git -C "$REPO" config user.name test
printf 'hello\n' > "$REPO/tracked.txt"
printf '.next/\ndist/\n' > "$REPO/.gitignore"
git -C "$REPO" add tracked.txt .gitignore
git -C "$REPO" commit -q -m init

# 1. Worktree with only regenerable (gitignored) artefacts removes cleanly.
WT_CLEAN="$TMP/wt-clean"
git -C "$REPO" worktree add -q -b wt-clean "$WT_CLEAN" >/dev/null 2>&1
mkdir -p "$WT_CLEAN/.next/cache"
echo x > "$WT_CLEAN/.next/cache/blob"
out="$(cd "$REPO" && bash "$HELPER" "$WT_CLEAN" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ] && [ ! -d "$WT_CLEAN" ]; then
  ok "clean worktree with only .next/ removes successfully"
else
  bad "clean worktree with only .next/ removes successfully (rc=$rc, out=$out)"
fi

# 2. A worktree with a real tracked modification still refuses — not force-removed.
WT_DIRTY="$TMP/wt-dirty"
git -C "$REPO" worktree add -q -b wt-dirty "$WT_DIRTY" >/dev/null 2>&1
printf 'changed\n' > "$WT_DIRTY/tracked.txt"
mkdir -p "$WT_DIRTY/.next"
echo x > "$WT_DIRTY/.next/blob"
out="$(cd "$REPO" && bash "$HELPER" "$WT_DIRTY" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && [ -d "$WT_DIRTY" ] && [ -f "$WT_DIRTY/tracked.txt" ]; then
  ok "worktree with a tracked modification still refuses removal"
else
  bad "worktree with a tracked modification still refuses removal (rc=$rc, out=$out)"
fi
git -C "$REPO" worktree remove -f -- "$WT_DIRTY" >/dev/null 2>&1

# 3. A worktree with a real untracked-and-not-ignored file also still refuses.
WT_UNTRACKED="$TMP/wt-untracked"
git -C "$REPO" worktree add -q -b wt-untracked "$WT_UNTRACKED" >/dev/null 2>&1
printf 'new source\n' > "$WT_UNTRACKED/new-file.txt"
mkdir -p "$WT_UNTRACKED/.next"
echo x > "$WT_UNTRACKED/.next/blob"
out="$(cd "$REPO" && bash "$HELPER" "$WT_UNTRACKED" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && [ -f "$WT_UNTRACKED/new-file.txt" ]; then
  ok "worktree with a real untracked file still refuses removal"
else
  bad "worktree with a real untracked file still refuses removal (rc=$rc, out=$out)"
fi
git -C "$REPO" worktree remove -f -- "$WT_UNTRACKED" >/dev/null 2>&1

echo "worktree-remove: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
