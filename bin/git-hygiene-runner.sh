#!/usr/bin/env bash
# git-hygiene-runner.sh — the command the launchd agent execs for the daily git hygiene sweep. (V-282)
#
# WHY A WRAPPER (not `git-hygiene.mjs` directly in the plist): launchd offers no pre-exec hook, so a
#   silent non-execution (node missing, wrong PATH, HOME unset) would leave the log empty and
#   indistinguishable from "never fired". This wrapper emits a dated HEARTBEAT line to stdout FIRST
#   (→ git-hygiene.log via the plist's StandardOutPath), proving the agent fired even if a step then
#   dies. It then runs git-hygiene.mjs against each configured repo with --apply --remote. The sibling
#   of harvest-feedback-runner.sh (V-265), retargeted to the hygiene helper.
#
# Invoked by ~/Library/LaunchAgents/com.v-coding-setup.git-hygiene.plist (see
#   bin/install-git-hygiene-launchd.sh), which routes stdout/stderr to git-hygiene.log. Run by hand
#   the output goes to your TERMINAL, not the log (the plist owns that redirect).
#
# REPOS: the list of checkouts to sweep. Each is `[ -d "$r/.git" ]`-guarded, so an absent/wrong path
#   is a SILENT SKIP, never a failure — the helper is repo-agnostic and "works for repo X" is verified
#   live per-machine, not asserted here (convention 8). Beyond ~/.claude (always swept), add checkouts
#   in ~/.claude/git-hygiene-repos.txt — one absolute path per line, `#` comments allowed.

set -uo pipefail

HELPER="$HOME/.claude/bin/git-hygiene.mjs"
NODE_BIN="$(command -v node || echo /opt/homebrew/bin/node)"
TS() { date -u +%FT%TZ; }

# The checkouts to keep tidy. The pipeline checkout is always swept; per-machine extras come from
# the optional config file (absent file = no extras; nonexistent paths are skipped, not failed).
REPOS=("$HOME/.claude")
REPOS_CONF="$HOME/.claude/git-hygiene-repos.txt"
if [ -f "$REPOS_CONF" ]; then
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    REPOS+=("$line")
  done < "$REPOS_CONF"
fi

echo "=== git-hygiene fired $(TS) (pid $$) ==="

# Load any git credentials .envrc carries (a GH token for the `push origin --delete` step). launchd is
# a non-login non-interactive shell that sources no rc, so a token must be put in the env here; without
# it the local FF + local prune still work and only the --remote deletion degrades (surfaced, skipped).
set -a; [ -f "$HOME/.claude/.envrc" ] && . "$HOME/.claude/.envrc"; set +a

if [ ! -x "$NODE_BIN" ]; then
  echo "=== git-hygiene ABORT $(TS): node not executable at $NODE_BIN ==="
  exit 127
fi

for repo in "${REPOS[@]}"; do
  if [ ! -d "$repo/.git" ]; then
    echo "--- skip $repo — not a git checkout on this machine ---"
    continue
  fi
  echo "--- sweeping $repo ---"
  "$NODE_BIN" "$HELPER" "$repo" --apply --remote || echo "--- git-hygiene returned non-zero for $repo (surfaced, continuing) ---"
done

echo "=== git-hygiene done $(TS) ==="
