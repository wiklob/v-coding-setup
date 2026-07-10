#!/usr/bin/env bash
# install-daily-plan-launchd.sh — install (idempotent) the morning /daily-plan run as a macOS
#   launchd LaunchAgent. (V-263 — twin of install-feedback-harvest-launchd.sh)
#
# WHY launchd, NOT cron: plain `cron` on macOS does not run while the machine is asleep and silently
#   SKIPS the missed slot. launchd's StartCalendarInterval runs a missed calendar slot on the NEXT
#   WAKE (missed slots coalesce to one run) — what a daily ritual on a frequently-asleep laptop needs.
#
# WHY launchd, NOT the CronCreate tool or a cloud /schedule routine (V-263's core mechanism call):
#   CronCreate/`/loop` jobs are session-bound (in-memory, gone when Claude exits, 7-day expiry) — they
#   cannot back a durable unattended ritual. A cloud /schedule routine can't read the LOCAL pipeline KB
#   (pipeline/roadmap.md, owed.md, the prior day's pipeline/daily/*-summary.md) — only a process on THIS
#   machine can. So the durable-AND-local path is launchd, like the harvesters.
#
# SCHEDULE: daily 09:27 local (morning) — AFTER the 09:07 bug harvest and 09:17 feedback harvest, so
#   the plan reads their fresh output (and yesterday's 20:37 summary).
#
# WHEN V-306 LANDS: its schedule-registry is designed for routines to self-register with no brief-code
#   edit — register this agent's label + log there so the morning brief picks it up (a small retrofit).
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.daily-plan.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.daily-plan"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/daily-plan-runner.sh"
LOG="$HOME/.claude/pipeline/audit/daily-plan.log"
GUI="gui/$(id -u)"

# --print (must be the FIRST arg): emit the generated plist to stdout and exit — no writes. For
#   inspecting or `plutil -lint`-ing the plist before installing.
PRINT_ONLY=0
[ "${1:-}" = "--print" ] && PRINT_ONLY=1

if [ "$PRINT_ONLY" -eq 0 ]; then
    mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
    chmod +x "$RUNNER" 2>/dev/null || true
fi

OUT="$PLIST"
[ "$PRINT_ONLY" -eq 1 ] && OUT="/dev/stdout"

# 1. Write the LaunchAgent plist (daily 09:27 local). Paths are baked in absolute at install time.
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
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key><integer>9</integer>
        <key>Minute</key><integer>27</integer>
    </dict>
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
    <false/>
    <key>ProcessType</key>
    <string>Background</string>
</dict>
</plist>
PLIST_EOF

[ "$PRINT_ONLY" -eq 1 ] && exit 0

# 2. Idempotent (re)load: bootout the old instance if present, then bootstrap the fresh plist.
launchctl bootout "$GUI" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"

echo "Installed launchd daily-plan agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: daily 09:27 local (after the 09:07/09:17 harvests; a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
