#!/usr/bin/env bash
# docs-refresh-runner.sh — the command the launchd agent execs for the daily docs-maintenance pass. (V-284)
#
# WHY A WRAPPER (not `claude` directly in the plist): launchd offers no pre-exec hook, so a
#   silent non-execution (claude binary missing, wrong PATH, HOME unset) would leave the log
#   empty and indistinguishable from "never fired". This wrapper emits a dated HEARTBEAT line to
#   stdout FIRST (→ docs-refresh.log via the plist's StandardOutPath), proving the agent fired
#   even if `claude` then dies. Only then does it exec the pass. A sibling of
#   harvest-feedback-runner.sh (V-265), retargeted to /docs-refresh.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.docs-refresh.plist (see
#   bin/install-docs-refresh-launchd.sh), which routes stdout/stderr to docs-refresh.log.
#   Run by hand the output goes to your TERMINAL, not the log (the plist owns that redirect) — so
#   to verify the log path, install the agent and `launchctl kickstart` it.

set -uo pipefail

CLAUDE_BIN="$HOME/.local/bin/claude"   # stable symlink — the versioned target changes on update.
TS() { date -u +%FT%TZ; }

if ! cd "$HOME/.claude"; then
  echo "=== docs-refresh FAILED $(TS): cannot cd ~/.claude ==="
  exit 1
fi

echo "=== docs-refresh fired $(TS) (pid $$) ==="

if [ ! -x "$CLAUDE_BIN" ]; then
  echo "=== docs-refresh ABORT $(TS): claude binary not executable at $CLAUDE_BIN ==="
  exit 127
fi

# Load secrets into the environment `exec claude` inherits (V-156). launchd + this non-login
# non-interactive bash runner source no shell rc, so the MCP `linear` wrapper's Bearer token must
# be put into the claude PROCESS env here, before exec (without it the wrapper 401s in a bg job).
# `set -a` auto-exports everything .envrc defines; the secret stays only in .envrc.
set -a; [ -f "$HOME/.claude/.envrc" ] && . "$HOME/.claude/.envrc"; set +a

exec "$CLAUDE_BIN" -p "/docs-refresh --yes"
