#!/usr/bin/env bash
# schedule-brief-runner.sh — the command the launchd agent execs for the daily morning brief. (V-306)
#
# WHY A WRAPPER (not `node` directly in the plist): launchd offers no pre-exec hook, so a silent
#   non-execution (node missing, wrong PATH) would leave the log empty and indistinguishable from
#   "never fired". This wrapper emits a dated HEARTBEAT line to stdout FIRST (→ schedule-brief.log
#   via the plist's StandardOutPath), proving the agent fired even if `node` then dies. Only then
#   does it exec the brief. The heartbeat's shape (`=== schedule-brief fired <ts> ===`) matches the
#   contract bin/schedule-brief.mjs parses, so the brief's OWN log is itself recap-able next morning
#   (the brief is registered as a routine, schedule 09:27). The twin of harvest-feedback-runner.sh.
#
# WHY NO SECRETS (unlike the harvest runners): the brief only reads local files (the registry + the
#   routine logs) — it never touches Linear/MCP — so it needs no .envrc Bearer token in its env.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.schedule-brief.plist (see
#   bin/install-schedule-brief-launchd.sh), which routes stdout/stderr to schedule-brief.log. Run by
#   hand the output goes to your TERMINAL, not the log (the plist owns that redirect).

set -uo pipefail

TS() { date -u +%FT%TZ; }

# Capture this run's timestamp ONCE and reuse it in both the heartbeat and the
# --exclude-heartbeat arg below: the brief reads its own log (StandardOutPath appends
# this heartbeat before node runs), so it must exclude THIS run's in-flight heartbeat
# (whose result: line isn't written yet) to report its last COMPLETED run rather than
# misreport itself as failed. Only the brief's own log carries this exact timestamp.
RUN_TS="$(TS)"

echo "=== schedule-brief fired $RUN_TS (pid $$) ==="

# Resolve node robustly. The scheduled agent runs under a minimal PATH that omits
# version-manager dirs (nvm / asdf / volta), so `command -v node` finds nothing even
# though node is installed for interactive shells (the failure this fixes). Fall back to
# a login shell (which sources the version-manager setup), then to an nvm glob picking
# the highest installed version.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$("${SHELL:-/bin/zsh}" -lc 'command -v node' 2>/dev/null | tail -1 || true)"
fi
if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then
  NODE_BIN="$(ls -1d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "=== schedule-brief ABORT $(TS): node not found (PATH, login shell, and nvm all failed) ==="
  exit 127
fi

exec "$NODE_BIN" "$HOME/.claude/bin/schedule-brief.mjs" --exclude-heartbeat "$RUN_TS"
