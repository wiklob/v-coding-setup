#!/usr/bin/env bash
# daily-summary-runner.sh — the command the launchd agent execs for the evening daily-summary
#   ritual. (V-263 — twin of harvest-feedback-runner.sh)
#
# WHY A WRAPPER (not `claude` directly in the plist): launchd offers no pre-exec hook, so a
#   silent non-execution (claude binary missing, wrong PATH, HOME unset) would leave the log
#   empty and indistinguishable from "never fired". This wrapper emits a dated HEARTBEAT line to
#   stdout FIRST (→ daily-summary.log via the plist's StandardOutPath), proving the agent fired
#   even if `claude` then dies. Only then does it exec the ritual.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.daily-summary.plist (see
#   bin/install-daily-summary-launchd.sh), which routes stdout/stderr to daily-summary.log.
#   Run by hand the output goes to your TERMINAL, not the log (the plist owns that redirect) — so
#   to verify the log path, install the agent and `launchctl kickstart` it.

set -uo pipefail

CLAUDE_BIN="$HOME/.local/bin/claude"   # stable symlink — the versioned target changes on update.
TS() { date -u +%FT%TZ; }

if ! cd "$HOME/.claude"; then
  echo "=== daily-summary FAILED $(TS): cannot cd ~/.claude ==="
  exit 1
fi

echo "=== daily-summary fired $(TS) (pid $$) ==="

if [ ! -x "$CLAUDE_BIN" ]; then
  echo "=== daily-summary ABORT $(TS): claude binary not executable at $CLAUDE_BIN ==="
  exit 127
fi

# Load env for parity with the harvesters (the ritual is local-file-only, but keep the pattern:
# harmless when .envrc is absent, and future Linear use inherits the Bearer token). `set -a`
# auto-exports everything .envrc defines; the secret stays only in .envrc.
set -a; [ -f "$HOME/.claude/.envrc" ] && . "$HOME/.claude/.envrc"; set +a

exec "$CLAUDE_BIN" -p "/daily-summary --yes"
