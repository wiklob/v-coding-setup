#!/usr/bin/env bash
# install-harvest-launchd.sh — install (idempotent) the daily /harvest-pipeline-bugs run as a
#   macOS launchd LaunchAgent. (V-110 — supersedes install-harvest-cron.sh)
#
# WHY launchd, NOT cron (V-110): plain `cron` on macOS does not run while the machine is asleep
#   and silently SKIPS the missed slot (never catches up). The 09:07 crontab slot was skipped
#   every time the Mac slept through it, so the harvest never ran and harvest.log never appeared.
#   launchd's StartCalendarInterval runs a missed calendar slot on the NEXT WAKE (multiple missed
#   slots coalesce to a single run) — exactly what a daily harvest on a frequently-asleep laptop
#   needs. Refs: Apple "Creating Launch Daemons and Agents"; launchd.plist(5).
#
# WHY LOCAL (not a remote /schedule routine): /harvest-pipeline-bugs reads
#   ~/.claude/pipeline/audit/errors.jsonl — a per-machine, gitignored runtime log. Only a process
#   on THIS machine can see it.
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it, and removes any
#   leftover V-52 crontab line (migrating off cron). Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.harvest-pipeline-bugs.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.harvest-pipeline-bugs"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/harvest-pipeline-bugs-runner.sh"
LOG="$HOME/.claude/pipeline/audit/harvest.log"
CRON_MARK="# v52-harvest-pipeline-bugs"
GUI="gui/$(id -u)"

# --print (must be the FIRST arg): emit the generated plist to stdout and exit — no
#   filesystem/crontab/launchctl writes. For inspecting or `plutil -lint`-ing the plist before
#   installing. Any other arg position is ignored and a real install proceeds.
PRINT_ONLY=0
[ "${1:-}" = "--print" ] && PRINT_ONLY=1

if [ "$PRINT_ONLY" -eq 0 ]; then
    mkdir -p "$HOME/Library/LaunchAgents" "$(dirname "$LOG")"
    chmod +x "$RUNNER" 2>/dev/null || true
fi

OUT="$PLIST"
[ "$PRINT_ONLY" -eq 1 ] && OUT="/dev/stdout"

# 1. Write the LaunchAgent plist (daily 09:07 local — off the :00 mark to avoid a thundering herd
#    with other scheduled jobs). Paths are baked in absolute at install time.
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
        <key>Minute</key><integer>7</integer>
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

# 2. Migrate off cron: drop only the prior V-52 harvest crontab line (the broken trigger),
#    preserving every other crontab entry untouched.
if crontab -l 2>/dev/null | grep -qF "$CRON_MARK"; then
    crontab -l 2>/dev/null | grep -vF "$CRON_MARK" | crontab -
    echo "Removed legacy crontab harvest line ($CRON_MARK)."
fi

# 3. Idempotent (re)load: bootout the old instance if present, then bootstrap the fresh plist.
launchctl bootout "$GUI" "$PLIST" 2>/dev/null || true
launchctl bootstrap "$GUI" "$PLIST"

# 4. Self-register into the schedule-registry (idempotent upsert — no-op if already present) so the
#    daily morning brief (bin/schedule-brief.mjs) recaps this routine's last run. (V-306)
node "$HOME/.claude/bin/register-routine.mjs" \
    --label "$LABEL" --name "pipeline-bug harvest" \
    --runner "bin/harvest-pipeline-bugs-runner.sh" --log "pipeline/audit/harvest.log" \
    --schedule "daily 09:07"

echo "Installed launchd harvest agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: daily 09:07 local (a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
