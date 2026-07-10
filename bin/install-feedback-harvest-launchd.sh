#!/usr/bin/env bash
# install-feedback-harvest-launchd.sh — install (idempotent) the daily /harvest-feedback run as a
#   macOS launchd LaunchAgent. (V-265 — the twin of install-harvest-launchd.sh)
#
# WHY launchd, NOT cron: plain `cron` on macOS does not run while the machine is asleep and silently
#   SKIPS the missed slot. launchd's StartCalendarInterval runs a missed calendar slot on the NEXT
#   WAKE (missed slots coalesce to one run) — what a daily harvest on a frequently-asleep laptop needs.
#
# WHY LOCAL (not a remote /schedule routine): /harvest-feedback reads
#   ~/.claude/pipeline/audit/feedback.jsonl — a per-machine, gitignored runtime log. Only a process
#   on THIS machine can see it.
#
# SCHEDULE: daily 09:17 local — offset 10 min after the bug harvester's 09:07 so the two daily jobs
#   don't fire at the same instant (and the feedback harvest can reference the bug run if ever wanted).
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.harvest-feedback.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.harvest-feedback"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/harvest-feedback-runner.sh"
LOG="$HOME/.claude/pipeline/audit/harvest-feedback.log"
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

# 1. Write the LaunchAgent plist (daily 09:17 local). Paths are baked in absolute at install time.
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
        <key>Minute</key><integer>17</integer>
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

# 3. Self-register into the schedule-registry (idempotent upsert — no-op if already present) so the
#    daily morning brief (bin/schedule-brief.mjs) recaps this routine's last run. (V-306)
node "$HOME/.claude/bin/register-routine.mjs" \
    --label "$LABEL" --name "feedback harvest" \
    --runner "bin/harvest-feedback-runner.sh" --log "pipeline/audit/harvest-feedback.log" \
    --schedule "daily 09:17"

echo "Installed launchd feedback-harvest agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: daily 09:17 local (a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
