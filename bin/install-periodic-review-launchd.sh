#!/usr/bin/env bash
# install-periodic-review-launchd.sh — install (idempotent) the weekly /periodic-review run as a
#   macOS launchd LaunchAgent. (V-264 — the twin of install-feedback-harvest-launchd.sh)
#
# WHY launchd, NOT cron: plain `cron` on macOS does not run while the machine is asleep and silently
#   SKIPS the missed slot. launchd's StartCalendarInterval runs a missed calendar slot on the NEXT
#   WAKE (missed slots coalesce to one run) — what a weekly review on a frequently-asleep laptop needs.
#
# WHY LOCAL (not a remote /schedule routine): /periodic-review reads
#   ~/.claude/.claude/usage-stats/ + ~/.claude/pipeline/audit/*.jsonl + gate-audit.md via
#   scorecard.mjs — all per-machine, gitignored runtime data. Only a process on THIS machine can see it.
#
# SCHEDULE: WEEKLY, Monday 09:27 local — an *in-depth* review wants enough lands to show a trend, so
#   it runs weekly, not daily. Minute 27 is offset from the daily harvesters (bugs 09:07, feedback
#   09:17) so the jobs never fire at the same instant on a Monday.
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.periodic-review.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.periodic-review"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/periodic-review-runner.sh"
LOG="$HOME/.claude/pipeline/audit/periodic-review.log"
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

# 1. Write the LaunchAgent plist (weekly Monday 09:27 local). Paths are baked in absolute at install
#    time. Weekday=1 = Monday (0 and 7 both mean Sunday in launchd).
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
        <key>Weekday</key><integer>1</integer>
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

echo "Installed launchd periodic-review agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: weekly Monday 09:27 local (a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
