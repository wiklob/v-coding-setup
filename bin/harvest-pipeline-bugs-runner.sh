#!/usr/bin/env bash
# harvest-pipeline-bugs-runner.sh — the command the launchd agent execs for the daily harvest. (V-110, V-384)
#
# WHY A WRAPPER (not `claude` directly in the plist): launchd offers no pre-exec hook, so a
#   silent non-execution (claude binary missing, wrong PATH, HOME unset) would leave harvest.log
#   empty and indistinguishable from "never fired" — the exact V-110 failure. This wrapper emits a
#   dated HEARTBEAT line to stdout FIRST (→ harvest.log via the plist's StandardOutPath), so the
#   log gains a dated, greppable entry proving the agent fired even if `claude` then dies. Only
#   then does it exec the harvest.
#
# THE PREFLIGHT (V-384): a headless launchd run has no TTY and no browser, so failures an
#   interactive session would just prompt through instead surface as a silent no-op or a cryptic
#   error buried in harvest.log. Every check below runs BEFORE claude is ever exec'd, so a failed
#   preflight leaves the watermark file untouched by construction (only the harvest command's own
#   §7, post-success, ever advances it):
#     - node not resolvable — mirrors docs-refresh-runner.sh's NODE_BIN pattern, and additionally
#       puts node's directory on PATH so the `node ~/.claude/bin/*.mjs` calls the harvest COMMAND
#       itself makes (via its own Bash tool, inside the exec'd claude session — not by this script)
#       inherit a resolvable `node` instead of launchd's bare minimal PATH.
#     - the `linear` MCP server isn't registered for this run's cwd. `claude mcp add` with no
#       `--scope` writes a LOCAL entry keyed to the cwd it was run from (~/.claude.json's
#       `projects.<cwd>.mcpServers`) — if that `add` ever ran from a directory other than the one
#       this runner `cd`s into, the tool surface silently isn't there for THIS headless run even
#       though `claude mcp list` shows it registered when run interactively elsewhere. `claude mcp
#       list` is a local, offline config read (no Linear network call) — safe to run every time as
#       a preflight. install.sh now recommends `--scope user` for exactly this reason (a user-scope
#       entry loads regardless of cwd).
#     - hosted OAuth (the default `https://mcp.linear.app/mcp` transport) cannot complete or
#       refresh its handshake headlessly — no TTY, no `/mcp` panel, no browser. If the cached token
#       has expired, no amount of retrying this script fixes it; only an interactive `claude mcp
#       login linear` (or a re-`add`) can. This preflight DETECTS that state (the linear line in
#       `claude mcp list` reports an error/expired/unauthorized status) and aborts with a distinct
#       message, but cannot repair it — that repair is out of scope for a launchd wrapper.
#   A fourth check — no new errors since the watermark — isn't a failure; it's a legitimate
#   empty-input day, so it exits 0 without spending a claude invocation at all.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.harvest-pipeline-bugs.plist (see
#   bin/install-harvest-launchd.sh), which routes this script's stdout/stderr to harvest.log via
#   StandardOutPath/StandardErrorPath. Run by hand the heartbeat + harvest output go to your
#   TERMINAL, not harvest.log (the plist owns that redirect) — so to verify the log path, install
#   the agent and `launchctl kickstart` it rather than running this script directly.

set -uo pipefail

CLAUDE_BIN="$HOME/.local/bin/claude"   # stable symlink — the versioned target changes on update.
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
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

if [ ! -x "$NODE_BIN" ]; then
  echo "=== harvest ABORT $(TS): node not executable at $NODE_BIN (the harvest command's own §1/§4/§7 steps need it) ==="
  exit 127
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

# Load secrets into the environment `exec claude` inherits (V-156). launchd and this
# non-login non-interactive bash runner source no shell rc, so ~/.zprofile/~/.zshenv never
# reach the claude process — but the MCP `linear` wrapper substitutes Authorization:
# `Bearer ${MCP_BEARER_TOKEN}` from the claude PROCESS env at session start. Sourcing the
# single-source secret file here, before exec, is what gives the bg-launched claude that
# bearer (without it the wrapper 401s / fails to load in every bg job). `set -a` auto-exports
# everything .envrc defines; the secret stays only in .envrc (never inlined here or in the plist).
set -a; [ -f "$HOME/.claude/.envrc" ] && . "$HOME/.claude/.envrc"; set +a

# --- MCP preflight (V-384): confirm `linear` is actually registered for THIS cwd, before
#   spending a claude invocation on a run that can't file anything. Local config read only.
MCP_STATUS="$("$CLAUDE_BIN" mcp list 2>&1)"
MCP_STATUS_RC=$?
if [ "$MCP_STATUS_RC" -ne 0 ]; then
  echo "=== harvest ABORT $(TS): \`claude mcp list\` failed (rc=$MCP_STATUS_RC) — cannot confirm the linear MCP server ==="
  echo "$MCP_STATUS"
  exit 3
fi
LINEAR_LINE="$(echo "$MCP_STATUS" | grep -i 'linear' || true)"
if [ -z "$LINEAR_LINE" ]; then
  echo "=== harvest ABORT $(TS): no \"linear\" MCP server registered for this cwd ($HOME/.claude) ==="
  echo "    fix: claude mcp add --transport http linear https://mcp.linear.app/mcp --scope user"
  exit 4
fi
if echo "$LINEAR_LINE" | grep -qiE 'fail|error|expired|unauthoriz'; then
  echo "=== harvest ABORT $(TS): linear MCP server registered but reporting an error — likely an expired OAuth token ==="
  echo "    $LINEAR_LINE"
  echo "    fix: interactively run \`claude mcp login linear\` (headless sessions cannot complete the OAuth handshake)"
  exit 5
fi

# --- empty-input short-circuit: don't spend a claude invocation on a day with nothing new. ---
NEW_COUNT="$("$NODE_BIN" "$HOME/.claude/bin/read-errors-since.mjs" | grep -c .)"
if [ "${NEW_COUNT:-0}" -eq 0 ]; then
  echo "=== harvest SKIP $(TS): no new errors since the watermark — nothing to harvest ==="
  exit 0
fi

exec "$CLAUDE_BIN" -p "/harvest-pipeline-bugs --yes"
