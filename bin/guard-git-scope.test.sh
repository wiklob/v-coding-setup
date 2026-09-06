#!/usr/bin/env bash
# Regression probe for V-672 — the guard-git-scope.py PreToolUse hook blocks a
# bare (unscoped) `git commit` / `git add -A` when the session's cwd resolves
# to the live ~/.claude checkout, and leaves every other invocation alone:
# other repos, explicit -C/--git-dir/--work-tree scoping, and non-mutating
# git subcommands.
#
# HERMETIC: builds a sandbox HOME with its own fake "~/.claude" git repo and a
# separate fake ticket-worktree git repo, so the probe never depends on this
# machine's real ~/.claude checkout.
#
# Usage:  bash bin/guard-git-scope.test.sh
# Exit:   0 = PASS, 1 = FAIL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK="$SCRIPT_DIR/guard-git-scope.py"
mkdir -p "$ROOT/tmp"

TMP="$(mktemp -d "$ROOT/tmp/guard-git-scope.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

FAKE_HOME="$TMP/home"
LIVE_CHECKOUT="$FAKE_HOME/.claude"
WORKTREE="$TMP/ticket-worktree"
mkdir -p "$LIVE_CHECKOUT/bin" "$WORKTREE"
git -C "$LIVE_CHECKOUT" init -q
git -C "$WORKTREE" init -q

fail=0

# Run a Bash command through the hook with a given cwd and fake HOME. Prints
# ALLOW (exit 0) or BLOCK (exit 2, first line of stderr).
run_hook() {   # <cwd> <command>
  CWD="$1" CMD="$2" HOME="$FAKE_HOME" python3 - <<PY
import json, os, subprocess
event = json.dumps({"tool_name": "Bash", "cwd": os.environ["CWD"],
                     "tool_input": {"command": os.environ["CMD"]}})
env = dict(os.environ)
p = subprocess.run(["python3", "$HOOK"], input=event,
                   capture_output=True, text=True, env=env)
if p.returncode == 2:
    print("BLOCK:" + p.stderr.strip().splitlines()[0])
elif p.returncode == 0:
    print("ALLOW")
else:
    print("UNEXPECTED_EXIT:" + str(p.returncode))
PY
}

expect_block() {   # <cwd> <command>
  got="$(run_hook "$1" "$2")"
  if [[ "$got" == BLOCK:* ]]; then
    echo "PASS: blocked: $2 (cwd=$1)"
  else
    echo "FAIL: expected block, got '$got' for: $2 (cwd=$1)"; fail=1
  fi
}

expect_allow() {    # <cwd> <command>
  got="$(run_hook "$1" "$2")"
  if [[ "$got" == "ALLOW" ]]; then
    echo "PASS: allowed: $2 (cwd=$1)"
  else
    echo "FAIL: expected allow, got '$got' for: $2 (cwd=$1)"; fail=1
  fi
}

# --- 1. Bare commit/add -A against the live checkout is blocked. ---
expect_block "$LIVE_CHECKOUT" 'git commit -m "oops"'
expect_block "$LIVE_CHECKOUT" 'git commit --amend'
expect_block "$LIVE_CHECKOUT" 'git add -A && git commit -m "x"'
expect_block "$LIVE_CHECKOUT" 'git add --all'
expect_block "$LIVE_CHECKOUT/bin" 'git commit -m "from a subdir"'   # resolves to same toplevel

# --- 2. Same bare invocations against a ticket worktree are unaffected. ---
expect_allow "$WORKTREE" 'git commit -m "fine"'
expect_allow "$WORKTREE" 'git add -A'

# --- 3. Explicit scoping is a deliberate escape hatch, even onto the live checkout. ---
expect_allow "$WORKTREE" "git -C $LIVE_CHECKOUT commit -m 'explicit -C'"
expect_allow "$WORKTREE" "git --work-tree=$LIVE_CHECKOUT --git-dir=$LIVE_CHECKOUT/.git commit -m x"

# --- 4. Non-mutating / non-targeted git subcommands are untouched. ---
expect_allow "$LIVE_CHECKOUT" 'git status'
expect_allow "$LIVE_CHECKOUT" 'git add file.txt'          # not -A/--all
expect_allow "$LIVE_CHECKOUT" 'git log --oneline -5'

if [[ $fail -ne 0 ]]; then
  echo "FAIL: guard-git-scope hook regression probe failed (V-672)."; exit 1
fi
echo "PASS: guard-git-scope hook blocks bare commit/add -A onto the live checkout and leaves all else alone (V-672)."
exit 0
