#!/usr/bin/env bash
# harvest-pipeline-bugs-runner.sh — the command the launchd agent execs for the daily harvest. (V-110)
#
# WHY A WRAPPER (not `claude` directly in the plist): launchd offers no pre-exec hook, so a
#   silent non-execution (claude binary missing, wrong PATH, HOME unset) would leave harvest.log
#   empty and indistinguishable from "never fired" — the exact V-110 failure. This wrapper emits a
#   dated HEARTBEAT line to stdout FIRST (→ harvest.log via the plist's StandardOutPath), so the
#   log gains a dated, greppable entry proving the agent fired even if `claude` then dies. Only
#   then does it exec the harvest.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.harvest-pipeline-bugs.plist (see
#   bin/install-harvest-launchd.sh), which routes this script's stdout/stderr to harvest.log via
#   StandardOutPath/StandardErrorPath. Run by hand the heartbeat + harvest output go to your
#   TERMINAL, not harvest.log (the plist owns that redirect) — so to verify the log path, install
#   the agent and `launchctl kickstart` it rather than running this script directly.

set -uo pipefail

CLAUDE_BIN="$HOME/.local/bin/claude"   # stable symlink — the versioned target changes on update.
TS() { date -u +%FT%TZ; }

if ! cd "$HOME/.claude"; then
  echo "=== harvest FAILED $(TS): cannot cd ~/.claude ==="
  exit 1
fi

echo "=== harvest fired $(TS) (pid $$) ==="

if [ ! -x "$CLAUDE_BIN" ]; then
  echo "=== harvest ABORT $(TS): claude binary not executable at $CLAUDE_BIN ==="
  exit 127
fi

# Load secrets into the environment `exec claude` inherits (V-156). launchd and this
# non-login non-interactive bash runner source no shell rc, so ~/.zprofile/~/.zshenv never
# reach the claude process — but the MCP `linear` wrapper substitutes Authorization:
# `Bearer ${MCP_BEARER_TOKEN}` from the claude PROCESS env at session start. Sourcing the
# single-source secret file here, before exec, is what gives the bg-launched claude that
# bearer (without it the wrapper 401s / fails to load in every bg job). `set -a` auto-exports
# everything .envrc defines; the secret stays only in .envrc (never inlined here or in the plist).
set -a; [ -f "$HOME/.claude/.envrc" ] && . "$HOME/.claude/.envrc"; set +a

exec "$CLAUDE_BIN" -p "/harvest-pipeline-bugs --yes"
