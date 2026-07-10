#!/usr/bin/env bash
# install-git-hygiene-launchd.sh — install (idempotent) the daily git-hygiene sweep as a
#   macOS launchd LaunchAgent. (V-282 — sibling of install-feedback-harvest-launchd.sh)
#
# WHY launchd, NOT cron: plain `cron` on macOS does not run while the machine is asleep and silently
#   SKIPS the missed slot. launchd's StartCalendarInterval runs a missed calendar slot on the NEXT
#   WAKE (missed slots coalesce to one run) — what a daily sweep on a frequently-asleep laptop needs.
#
# WHY LOCAL (not a remote /schedule routine): the sweep operates on this machine's local checkouts +
#   worktrees (fast-forwards local main, prunes local branches/worktrees). Only a process on THIS
#   machine can see and tidy them.
#
# SCHEDULE: daily 09:27 local — offset 10 min after the feedback harvester's 09:17 (itself 10 min after
#   the bug harvester's 09:07) so the three daily jobs don't fire at the same instant.
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.git-hygiene.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.git-hygiene"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/git-hygiene-runner.sh"
LOG="$HOME/.claude/pipeline/audit/git-hygiene.log"
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

echo "Installed launchd git-hygiene agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: daily 09:27 local (a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
