#!/usr/bin/env bash
# Regression probe for V-683 — the guard-grep.py PreToolUse hook blocks a bare
# `grep` command invocation (ugrep on this machine, which rejects GNU-grep/find
# syntax) and leaves every other command — including `grep` as an argument, or
# behind an escape hatch (`command grep`, a full path) — untouched.
#
# HERMETIC: invokes the hook directly with synthetic PreToolUse JSON events; no
# dependency on this machine's HOME, PATH, or which `grep` binary is installed.
#
# Usage:  bash bin/guard-grep.test.sh
# Exit:   0 = PASS, 1 = FAIL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/guard-grep.py"

fail=0

# Run a Bash command through the hook. Prints ALLOW (exit 0, no stdout JSON) or
# BLOCK (exit 2, stderr reason on stdout of this helper).
run_hook() {
  CMD="$1" python3 - <<PY
import json, os, subprocess
cmd = os.environ["CMD"]
event = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}})
p = subprocess.run(["python3", "$HOOK"], input=event,
                   capture_output=True, text=True)
if p.returncode == 2:
    print("BLOCK:" + p.stderr.strip().splitlines()[0])
elif p.returncode == 0:
    print("ALLOW")
else:
    print("UNEXPECTED_EXIT:" + str(p.returncode))
PY
}

expect_block() {   # <input>
  got="$(run_hook "$1")"
  if [[ "$got" == BLOCK:* ]]; then
    echo "PASS: blocked: $1"
  else
    echo "FAIL: expected block, got '$got' for: $1"; fail=1
  fi
}

expect_allow() {    # <input>
  got="$(run_hook "$1")"
  if [[ "$got" == "ALLOW" ]]; then
    echo "PASS: allowed: $1"
  else
    echo "FAIL: expected allow, got '$got' for: $1"; fail=1
  fi
}

# --- 1. Bare `grep` in command position is blocked. ---
expect_block 'grep -rn "foo" .'
expect_block 'grep foo bar.txt'
expect_block 'VAR=1 grep -r foo .'
expect_block 'cd /tmp && grep -rn foo .'
expect_block 'echo hi; grep foo x.txt'

# --- 2. Escape hatches and non-command-position uses are left alone. ---
expect_allow 'rg -n "foo" .'
expect_allow 'command grep -rn foo .'
expect_allow '/usr/bin/grep -rn foo .'
expect_allow '/opt/homebrew/bin/grep -rn foo .'
expect_allow 'echo "run grep later"'
expect_allow 'git commit -m "mention grep in a message"'
expect_allow 'echo grep'

if [[ $fail -ne 0 ]]; then
  echo "FAIL: guard-grep hook regression probe failed (V-683)."; exit 1
fi
echo "PASS: guard-grep hook blocks bare grep and leaves all else alone (V-683)."
exit 0
