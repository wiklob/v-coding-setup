#!/usr/bin/env bash
# mcp-bearer-setenv.sh — publish MCP_BEARER_TOKEN into the launchd per-user (gui/<uid>) global
#   environment so APP-SPAWNED background `claude` sessions inherit it and the self-hosted `linear`
#   MCP wrapper can substitute `Authorization: Bearer ${MCP_BEARER_TOKEN}` at session start. (V-170)
#
# WHY THIS EXISTS (and why it differs from the launchd-harvest fix, V-156): a GUI-app-spawned
#   `claude` takes no shell rc and no .envrc — it inherits only the launchd per-user domain env as it
#   stood when the process launched. V-156 could source .envrc in the harvest *runner* because that
#   path has a pre-exec wrapper script; the app path has none — `~/.local/bin/claude` is a Mach-O
#   binary launched directly, with no seam to source secrets. So the bearer must already be ambient
#   in the launchd per-user domain BEFORE the claude process launches — which is what
#   `launchctl setenv` does. Run at login by com.v-coding-setup.mcp-bearer-setenv (RunAtLoad), it sets
#   the var before any GUI app / app-spawned session starts. Empirically grounded (V-170): from
#   inside an app-spawned bg session, MCP_BEARER_TOKEN was ABSENT from the process env while PRESENT
#   in the launchd global env, and the top-level `~/.local/bin/claude` had PPID 1 (reparented to
#   launchd) — i.e. it inherits env from the launchd domain at its own launch, not from any shell.
#
# SECRET-EXPOSURE TRADE-OFF: launchctl setenv places the bearer in the launchd per-user global env,
#   readable by ANY process in the user's GUI session via `launchctl getenv MCP_BEARER_TOKEN` —
#   broader than .envrc (file-perm + direnv + the secret-access guard). Acceptable for a single-user
#   workstation; documented in pipeline/audit/v-107-cutover-measurement.md. The secret is never
#   inlined here or in the plist — it is single-sourced from ~/.claude/.envrc at run time.

set -uo pipefail

ENVRC="$HOME/.claude/.envrc"
TS() { date -u +%FT%TZ; }

if [ ! -f "$ENVRC" ]; then
  echo "mcp-bearer-setenv $(TS): ABORT — $ENVRC not found; cannot source MCP_BEARER_TOKEN" >&2
  exit 1
fi

# Source .envrc to load MCP_BEARER_TOKEN (and whatever else it defines) into the env, without ever
#   echoing the value. set -a auto-exports; the secret never reaches stdout/stderr.
set -a
# shellcheck disable=SC1090
. "$ENVRC"
set +a

if [ -z "${MCP_BEARER_TOKEN:-}" ]; then
  echo "mcp-bearer-setenv $(TS): ABORT — MCP_BEARER_TOKEN empty/undefined after sourcing $ENVRC" >&2
  exit 1
fi

# Publish to the launchd per-user domain. Fail loud rather than silently no-op (convention 8).
if launchctl setenv MCP_BEARER_TOKEN "$MCP_BEARER_TOKEN"; then
  echo "mcp-bearer-setenv $(TS): published MCP_BEARER_TOKEN to launchd gui/$(id -u) domain"
else
  echo "mcp-bearer-setenv $(TS): ABORT — launchctl setenv failed" >&2
  exit 1
fi
