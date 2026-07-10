#!/usr/bin/env bash
# ~/.claude/bin/worktree-remove.sh
# Single allowlisted call for the /land-ticket §7 worktree-teardown remove step.
#
# Usage:
#   bash ~/.claude/bin/worktree-remove.sh <worktree-path>
#
# Why this exists (V-114): the teardown's `git worktree remove "<wt>"` is
# allow-listed (Bash(git *)), but agents kept running it as an ad-hoc compound to
# capture output/exit — e.g. `git worktree remove "<wt>" 2>&1 | tail -3; echo
# "remove exit: $?"`. A pipe/chain matches NO allowlist prefix, so the padded form
# prompts ("Do you want to proceed?") on every land despite the rule (conv. 7;
# same family as V-73/V-93). This helper is ONE call that matches the already-
# allow-listed `Bash(bash ~/.claude/bin/*.sh)` prefix and reports the result +
# git's own exit code itself, so there is nothing left to staple on.
#
# Never force-removes: a worktree with uncommitted changes makes `git worktree
# remove` refuse (exit non-zero) — that refusal is surfaced verbatim so the caller
# STOPs and asks, exactly as the bare command would (§7: "refuses on changes →
# STOP, ask; never force").

set -u

wt="${1:?usage: worktree-remove.sh <worktree-path>}"

# `--` stops option parsing: this repo's worktrees are named `-claude-wt-*` (leading
# dash), which git would otherwise treat as a flag (V-36).
out="$(git worktree remove -- "$wt" 2>&1)"
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "worktree-remove: removed $wt"
else
  echo "worktree-remove: FAILED (exit $rc) for $wt — refuses on changes; do NOT force, STOP and ask."
  [ -n "$out" ] && echo "$out"
fi

exit "$rc"
