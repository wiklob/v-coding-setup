#!/usr/bin/env bash
# install-schedule-brief-launchd.sh — install (idempotent) the daily morning brief as a macOS
#   launchd LaunchAgent, and self-register the brief into the schedule-registry. (V-306 — the third
#   sibling of install-harvest-launchd.sh / install-feedback-harvest-launchd.sh)
#
# WHY launchd, NOT cron: plain `cron` on macOS does not run while the machine is asleep and silently
#   SKIPS the missed slot. launchd's StartCalendarInterval runs a missed calendar slot on the NEXT
#   WAKE (missed slots coalesce to one run) — what a daily brief on a frequently-asleep laptop needs.
#
# WHY LOCAL (not a remote /schedule routine): the brief reads the routine run logs under
#   ~/.claude/pipeline/audit/*.log — per-machine, gitignored runtime logs only a process on THIS
#   machine can see.
#
# SCHEDULE: daily 09:27 local — offset 10 min after the feedback harvester's 09:17 (which is itself
#   10 min after the bug harvester's 09:07), so the brief fires AFTER both harvests and recaps that
#   morning's runs. Offset-as-sequencing is the same precedent the two harvests already use; launchd
#   gives no dependency-chain primitive, and "last-run outcome" reads the last completed log block
#   regardless of exact overlap.
#
# Idempotent: re-running rewrites the plist, bootout->bootstrap reloads it, and the register-routine
#   upsert is a no-op when the brief is already registered. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.schedule-brief.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.schedule-brief"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/schedule-brief-runner.sh"
LOG="$HOME/.claude/pipeline/audit/schedule-brief.log"
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

# 3. Self-register the brief into the schedule-registry (idempotent upsert — no-op if already
#    present). This is what makes the brief itself a recap-able routine, and the worked example that
#    a routine added to the registry surfaces in the brief with no schedule-brief.mjs edit.
node "$HOME/.claude/bin/register-routine.mjs" \
    --label "$LABEL" --name "morning brief" \
    --runner "bin/schedule-brief-runner.sh" --log "pipeline/audit/schedule-brief.log" \
    --schedule "daily 09:27"

echo "Installed launchd morning-brief agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: daily 09:27 local (after the 09:07/09:17 harvests; a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
