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

# Regenerable build artefacts that routinely make `git worktree remove` refuse
# with "Directory not empty" even though there is no real work to lose (V-527:
# 33 of 34 accumulated cbapp worktrees carried nothing but leftover .next/
# output). Extend this list as new build tools land regenerable output under a
# worktree root — never widen the removal itself to a blanket `git clean -fdx`.
REGENERABLE_ARTEFACTS="
.next
.turbo
node_modules/.cache
dist
build
coverage
"

if [ -d "$wt" ]; then
  for artefact in $REGENERABLE_ARTEFACTS; do
    [ -e "$wt/$artefact" ] || continue
    # -X removes ONLY paths git already ignores for this worktree — never a
    # tracked file, never an untracked-but-not-ignored file. A worktree with a
    # real uncommitted change (tracked or untracked-and-not-ignored) is
    # untouched here and still makes the removal below refuse, unchanged.
    git -C "$wt" clean -fdX -- "$artefact" >/dev/null 2>&1 || true
  done
fi

# `--` stops option parsing for arbitrary paths, including historical legacy
# sibling names that began with a dash (V-36). Managed worktree names do not rely
# on that legacy shape, but teardown stays defensive during migration.
out="$(git worktree remove -- "$wt" 2>&1)"
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "worktree-remove: removed $wt"
else
  echo "worktree-remove: FAILED (exit $rc) for $wt — refuses on changes; do NOT force, STOP and ask."
  [ -n "$out" ] && echo "$out"
fi

exit "$rc"
