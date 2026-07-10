#!/usr/bin/env bash
# install-mcp-bearer-setenv.sh — install (idempotent) the login LaunchAgent that publishes
#   MCP_BEARER_TOKEN into the launchd per-user (gui/<uid>) global env at login, so APP-SPAWNED
#   background `claude` sessions inherit the bearer for the self-hosted `linear` MCP wrapper. (V-170)
#
# WHY a login LaunchAgent (not the V-156 runner approach): a GUI-app-spawned `claude` inherits only
#   the launchd per-user domain env as it stood at launch — no shell rc, no .envrc (the app launches
#   the Mach-O `claude` binary directly, with no pre-exec hook to source secrets, unlike the V-156
#   harvest runner). The token must therefore be ambient in the launchd domain BEFORE the process
#   starts; RunAtLoad at login does that. Refs: Apple "Creating Launch Daemons and Agents";
#   launchd.plist(5); launchctl(1) setenv. Mirrors bin/install-harvest-launchd.sh (inline plist
#   generation with paths baked absolute at install time; --print for inspection).
#
# The secret is never written here or into the plist — the runner (bin/mcp-bearer-setenv.sh)
#   single-sources it from ~/.claude/.envrc at run time. The plist's EnvironmentVariables stays
#   PATH-only (same as the harvest plist).
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.mcp-bearer-setenv.plist
#   && rm that plist   (then `launchctl unsetenv MCP_BEARER_TOKEN` to clear the live value).

set -euo pipefail

LABEL="com.v-coding-setup.mcp-bearer-setenv"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/mcp-bearer-setenv.sh"
LOG="$HOME/.claude/pipeline/audit/mcp-bearer-setenv.log"
GUI="gui/$(id -u)"

# --print (must be the FIRST arg): emit the generated plist to stdout and exit — no
#   filesystem/launchctl writes. For inspecting or `plutil -lint`-ing the plist before installing.
PRINT_ONLY=0
[ "${1:-}" = "--print" ] && PRINT_ONLY=1

if [ "$PRINT_ONLY" -eq 0 ]; then
    mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
    chmod +x "$RUNNER" 2>/dev/null || true
fi

OUT="$PLIST"
[ "$PRINT_ONLY" -eq 1 ] && OUT="/dev/stdout"

# Write the LaunchAgent plist. RunAtLoad=true → runs once at login (and at bootstrap). One-shot
#   setenv: no KeepAlive, no StartCalendarInterval. Paths baked absolute at install time.
cat > "$OUT" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$RUNNER</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST_EOF

[ "$PRINT_ONLY" -eq 1 ] && exit 0

# Fail loud at install if the runner isn't executable at its canonical path. Otherwise
#   bootstrap+kickstart "succeed" while the job dies at runtime, logged only to $LOG that nobody
#   reads — the silent-failure shape convention 8 exists to kill. (The chmod above is best-effort;
#   this is the hard check.)
if [ ! -x "$RUNNER" ]; then
    echo "ABORT: runner not executable at $RUNNER — land/install bin/mcp-bearer-setenv.sh first." >&2
    exit 1
fi

# Idempotent (re)load: bootout the old instance if present, then bootstrap the fresh plist, then
#   kickstart once so the var is published immediately (not only on the next login).
launchctl bootout "$GUI" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"
launchctl kickstart -k "$GUI/$LABEL"

echo "Installed launchd MCP-bearer setenv agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  trigger: RunAtLoad (login) — publishes MCP_BEARER_TOKEN to the launchd $GUI domain"
echo
echo "NOTE: already-running apps do NOT inherit a var set after their launch. Relaunch the Claude"
echo "      app (or re-login) so app-spawned bg sessions pick up the bearer."
echo "Verify published: launchctl getenv MCP_BEARER_TOKEN   (prints the value — run in a private shell)"
echo "Verify end-to-end: in a fresh app-spawned bg session with linear routed to the wrapper"
echo "      (linear-wrapper-toggle use wrapper), confirm \`claude doctor\` shows linear with no"
echo "      missing MCP_BEARER_TOKEN / no 401."
