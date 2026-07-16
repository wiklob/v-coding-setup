#!/usr/bin/env bash
# install-spawn-observer-launchd.sh — install (idempotent) the spawn-observer watchdog as a macOS
#   launchd LaunchAgent firing every 60 seconds.
#
# WHY: guard-agent-spawn.py (PreToolUse) is the in-band cap on subagent cascades; this observer is
#   the OUT-OF-BAND backstop — an enforcement layer outside the process being limited, so a session
#   that bypasses hooks (misconfig, foreign client, future tool) is still caught by its filesystem
#   footprint and soft-stopped via ~/.claude/spawn-guard.blocklist. Built after 2026-07-15: one job
#   spawned 132 agents in a single minute; a 60s interval catches that inside one tick.
#
# Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.spawn-observer.plist \
#   && rm ~/Library/LaunchAgents/com.v-coding-setup.spawn-observer.plist

set -euo pipefail

LABEL="com.v-coding-setup.spawn-observer"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT="$HOME/.claude/bin/spawn-observer.py"
LOG="$HOME/.claude/spawn-observer.log"
GUI="gui/$(id -u)"

# --print (must be the FIRST arg): emit the generated plist to stdout and exit — no writes.
PRINT_ONLY=0
[ "${1:-}" = "--print" ] && PRINT_ONLY=1

if [ "$PRINT_ONLY" -eq 0 ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    chmod +x "$SCRIPT" 2>/dev/null || true
fi

OUT="$PLIST"
[ "$PRINT_ONLY" -eq 1 ] && OUT="/dev/stdout"

cat > "$OUT" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>$SCRIPT</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StandardOutPath</key>
    <string>$LOG</string>
    <key>StandardErrorPath</key>
    <string>$LOG</string>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST_EOF

[ "$PRINT_ONLY" -eq 1 ] && exit 0

# 2. (Re)load it: bootout is a no-op error on first install — tolerated.
launchctl bootout "$GUI" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"
echo "installed: $LABEL (every 60s), log at $LOG"
