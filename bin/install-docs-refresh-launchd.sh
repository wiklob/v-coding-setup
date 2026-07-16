#!/usr/bin/env bash
# install-docs-refresh-launchd.sh — install (idempotent) the daily /docs-refresh pass as a
#   macOS launchd LaunchAgent. (V-284 — a sibling of install-feedback-harvest-launchd.sh)
#
# WHY launchd, NOT cron: plain `cron` on macOS does not run while the machine is asleep and silently
#   SKIPS the missed slot. launchd's StartCalendarInterval runs a missed calendar slot on the NEXT
#   WAKE (missed slots coalesce to one run) — what a daily doc pass on a frequently-asleep laptop needs.
#
# WHY LOCAL (not a remote /schedule routine): /docs-refresh reviews a local checkout's git history
#   since a per-machine watermark and applies doc updates to the working tree before opening its
#   daily PR. Only a process on THIS machine can see those checkouts.
#
# ONE MACHINE-GLOBAL AGENT, MANY REPOS (V-375): this installs a SINGLE agent whose runner
#   (bin/docs-refresh-runner.sh) sweeps every checkout that opts into `docs.maintenance: "daily"` —
#   ~/.claude always, plus any absolute path listed in ~/.claude/docs-refresh-repos.txt. The runner
#   filters by each repo's own ticket-flow.json and keeps a per-repo watermark, so adding a repo is a
#   registry-file edit, NOT another launchd agent. Nothing here is repo-specific; the plist is generic.
#
# SCHEDULE: daily 09:47 local — after the morning cluster (09:07 bugs, 09:17 feedback, 09:27 plan/brief)
#   so the jobs don't fire at the same instant and the doc pass runs once the day's earlier rituals
#   have settled.
#
# Idempotent: re-running rewrites the plist and bootout->bootstrap reloads it. Uninstall:
#   launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.v-coding-setup.docs-refresh.plist
#   && rm that plist.

set -euo pipefail

LABEL="com.v-coding-setup.docs-refresh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$HOME/.claude/bin/docs-refresh-runner.sh"
LOG="$HOME/.claude/pipeline/audit/docs-refresh.log"
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

# 1. Write the LaunchAgent plist (daily 09:47 local). Paths are baked in absolute at install time.
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
        <key>Minute</key><integer>47</integer>
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
    --label "$LABEL" --name "docs refresh" \
    --runner "bin/docs-refresh-runner.sh" --log "pipeline/audit/docs-refresh.log" \
    --schedule "daily 09:47"

echo "Installed launchd docs-refresh agent: $LABEL"
echo "  plist  -> $PLIST"
echo "  runner -> $RUNNER"
echo "  log    -> $LOG"
echo "  schedule: daily 09:47 local (a slot missed while asleep runs on next wake)"
echo "Force a test run: launchctl kickstart -k $GUI/$LABEL"
echo "Verify loaded:    launchctl print $GUI/$LABEL | head"
