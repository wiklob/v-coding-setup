#!/usr/bin/env bash
# Regression probe for V-337 — the guard-repo-cd.py PreToolUse hook rewrites a
# `cd` into the slug-derived nonexistent checkout path (`~/<repo-name>`) into the
# real checkout, and leaves every other command untouched.
#
# This is the encoded proof (this repo is test-less: shell + markdown, no toolchain):
# it feeds the EXACT failing command shape from the harvested errors
# (`cd ~/<repo-name> && gh pr view <n>`) through the hook and asserts the rewrite,
# and feeds benign / boundary / string-embedded commands and asserts NO rewrite.
# Run by hand after editing the hook.
#
# HERMETIC: builds a sandbox checkout (fake HOME + fake root with its own
# ticket-flow.json and a copy of the hook) so the probe never depends on this
# machine's real HOME, checkout location, or ticket-flow config.
#
# Usage:  bash bin/guard-repo-cd.test.sh
# Exit:   0 = PASS, 1 = FAIL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
mkdir -p "$ROOT/tmp"

TMP="$(mktemp -d "$ROOT/tmp/guard-repo-cd.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Sandbox: a fake HOME and a fake checkout whose basename differs from the repo
# name in its ticket-flow (slug alice/myrepo -> bad path $FAKE_HOME/myrepo, which
# does not exist; the real checkout is $FAKE_ROOT).
FAKE_HOME="$TMP/home"
FAKE_ROOT="$TMP/checkout"
mkdir -p "$FAKE_HOME" "$FAKE_ROOT/bin" "$FAKE_ROOT/.claude"
cp "$SCRIPT_DIR/guard-repo-cd.py" "$FAKE_ROOT/bin/guard-repo-cd.py"
printf '{"repo": "alice/myrepo"}\n' > "$FAKE_ROOT/.claude/ticket-flow.json"

export HOOK="$FAKE_ROOT/bin/guard-repo-cd.py"
export FAKE_HOME

fail=0

# Run a Bash command through the hook; print the RESULTING command (rewritten if the
# hook fired, else the original — an empty hook stdout means allow_noop / no rewrite).
run_hook() {
  CMD="$1" HOME="$FAKE_HOME" python3 - <<'PY'
import json, os, subprocess
cmd = os.environ["CMD"]
event = json.dumps({"tool_name": "Bash", "tool_input": {"command": cmd}})
p = subprocess.run(["python3", os.environ["HOOK"]], input=event,
                   capture_output=True, text=True)
out = p.stdout.strip()
if not out:
    print("__NOOP__")
else:
    print(json.loads(out)["hookSpecificOutput"]["updatedInput"]["command"])
PY
}

expect_rewrite() {  # <input> <expected-rewritten-command>
  got="$(run_hook "$1")"
  if [[ "$got" == "$2" ]]; then
    echo "PASS: rewrote -> $got"
  else
    echo "FAIL: '$1'"; echo "  expected: $2"; echo "  got:      $got"; fail=1
  fi
}

expect_noop() {     # <input>
  got="$(run_hook "$1")"
  if [[ "$got" == "__NOOP__" ]]; then
    echo "PASS: left untouched: $1"
  else
    echo "FAIL: hook wrongly rewrote a command it should leave alone: $1"
    echo "  got: $got"; fail=1
  fi
}

# --- 1. The exact failing command shapes from the harvested errors are rewritten. ---
expect_rewrite "cd $FAKE_HOME/myrepo && gh pr view 246 --json state" \
               "cd $FAKE_ROOT && gh pr view 246 --json state"
expect_rewrite "cd \"$FAKE_HOME/myrepo\" && git log" \
               "cd \"$FAKE_ROOT\" && git log"
expect_rewrite "MAIN_WT=x; cd $FAKE_HOME/myrepo && gh pr view 197" \
               "MAIN_WT=x; cd $FAKE_ROOT && gh pr view 197"

# --- 2. Commands the hook must NOT touch. ---
expect_noop "cd $FAKE_ROOT && gh pr view 1"                    # the real checkout
expect_noop "cd $FAKE_ROOT/.claude/worktrees/checkout-wt-v-337 && git status"  # managed worktree
expect_noop "cd $FAKE_HOME/myrepos && ls"                      # longer sibling (bad path is a prefix)
expect_noop 'gh pr view 246 --repo alice/myrepo'               # no cd at all
expect_noop "echo cd $FAKE_HOME/myrepo"                        # cd is an argument
expect_noop "git commit -m \"V-337: fix cd $FAKE_HOME/myrepo derivation\""  # cd in a string

if [[ $fail -ne 0 ]]; then
  echo "FAIL: guard-repo-cd hook regression probe failed (V-337)."; exit 1
fi
echo "PASS: guard-repo-cd hook rewrites the slug-derived cd and leaves all else alone (V-337)."
exit 0
