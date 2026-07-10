#!/usr/bin/env bash
# orphan-detect.test.sh — worked repro for bin/orphan-detect (V-89).
# The encoded proof of the negative for the ticket's safety property: an
# interrupted setup (binding-less worktree on a ticket branch) is RECOGNIZED as
# recoverable instead of dead-stopping every later run — while genuinely
# ambiguous states (dirty / base-branch / detached) still keep the hard STOP.
#
# Builds real throwaway git worktree fixtures and asserts the verdict contract:
#   binding present                       → has-binding
#   binding absent + clean + ticket branch→ orphan-recoverable   (the cure)
#   binding absent + dirty                → dirty-stop            (STOP preserved)
#   binding absent + clean + branch==base → foreign-stop         (STOP preserved)
#   binding absent + clean + detached     → foreign-stop         (STOP preserved)
#   missing args / non-worktree path      → exit 4               (loud failure)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DETECT="$HERE/orphan-detect.sh"
pass=0; fail=0
ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s (got: %s)\n' "$1" "$2"; fail=$((fail+1)); }

box="$(mktemp -d)"; trap 'rm -rf "$box"' EXIT

# --- main repo with one commit on `main` ---
REPO="$box/repo"
git init -q -b main "$REPO"
git -C "$REPO" config user.email t@t.test
git -C "$REPO" config user.name test
printf 'seed\n' > "$REPO/seed.txt"
git -C "$REPO" add seed.txt
git -C "$REPO" commit -qm seed

TICKET_BRANCH="flingelms30/v-99-some-ticket"

# --- fixture A: orphan — worktree on a ticket branch, no binding, clean ---
WT_ORPHAN="$box/wt-orphan"
git -C "$REPO" worktree add -q -b "$TICKET_BRANCH" "$WT_ORPHAN" main
# (no .claude/active-project.json written — this is the crashed-mid-setup state)

# --- fixture B: detached worktree on base, no binding, clean ---
WT_DETACHED="$box/wt-detached"
git -C "$REPO" worktree add -q --detach "$WT_DETACHED" main

v() { "$DETECT" "$@" 2>/dev/null; }

# 1. orphan-recoverable — the cure: an interrupted setup is recognized, not dead-stopped.
out="$(v "$WT_ORPHAN" main)"
[ "$out" = "orphan-recoverable" ] && ok "binding-less + clean + ticket branch → orphan-recoverable" || bad "orphan not recognized" "$out"

# 2. has-binding — once the binding exists, it's no longer an orphan.
mkdir -p "$WT_ORPHAN/.claude"
printf '{ "linearProject": "x" }\n' > "$WT_ORPHAN/.claude/active-project.json"
out="$(v "$WT_ORPHAN" main)"
[ "$out" = "has-binding" ] && ok "binding present → has-binding" || bad "binding present misclassified" "$out"
rm -rf "$WT_ORPHAN/.claude"

# 3. dirty-stop — possible real work, STOP preserved.
printf 'wip\n' > "$WT_ORPHAN/uncommitted.txt"
out="$(v "$WT_ORPHAN" main)"
[ "$out" = "dirty-stop" ] && ok "binding-less + dirty → dirty-stop (STOP preserved)" || bad "dirty tree not stopped" "$out"
rm -f "$WT_ORPHAN/uncommitted.txt"

# 4. foreign-stop (branch == base) — ambiguous, STOP preserved.
out="$(v "$WT_ORPHAN" "$TICKET_BRANCH")"
[ "$out" = "foreign-stop" ] && ok "binding-less + branch==base → foreign-stop (STOP preserved)" || bad "branch==base not stopped" "$out"

# 5. foreign-stop (detached HEAD) — ambiguous, STOP preserved.
out="$(v "$WT_DETACHED" main)"
[ "$out" = "foreign-stop" ] && ok "binding-less + detached → foreign-stop (STOP preserved)" || bad "detached not stopped" "$out"

# 6. usage error — loud exit 4, never a silent misclassification.
"$DETECT" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 4 ] && ok "missing args → exit 4" || bad "missing args not exit 4" "$rc"
"$DETECT" "$box/does-not-exist" main >/dev/null 2>&1; rc=$?
[ "$rc" -eq 4 ] && ok "non-worktree path → exit 4" || bad "non-worktree path not exit 4" "$rc"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
