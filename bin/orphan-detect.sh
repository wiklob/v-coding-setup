#!/usr/bin/env bash
# ~/.claude/bin/orphan-detect.sh
# Classify an EXISTING worktree for /next-ticket §1.C's "worktree exists" branch (V-89).
#
# The orphan: /next-ticket (or /go) runs `git worktree add` but the run dies
# before writing the .claude/active-project.json binding marker, leaving a
# binding-less worktree parked on a ticket branch. Without this, §1.C treats
# "worktree exists + missing binding" as a bare hard STOP, so every later run
# for the project dead-stops on the same orphan until a human removes it.
#
# This helper is the single source of truth for the orphan signature: the skill
# prose calls it and orphan-detect.test.sh exercises it, so the predicate can
# never drift between doc and behavior.
#
# Usage:
#   bin/orphan-detect.sh <WT_ABS> <baseBranch>
#
# Prints exactly one verdict on stdout (exit 0):
#   has-binding        — .claude/active-project.json present; NOT an orphan,
#                        the existing mode-match logic in §1.C takes over.
#   orphan-recoverable — binding absent, working tree CLEAN, checked-out branch
#                        is a non-base ticket branch. The recognizable orphan:
#                        §1.C OFFERS recovery (reconstruct binding / clean+recreate)
#                        instead of a bare STOP. The deterministic worktree path
#                        already encodes the project/issue, so reconstruction is safe.
#   dirty-stop         — binding absent but the tree is DIRTY; possible real work,
#                        keep the hard STOP.
#   foreign-stop       — binding absent, clean, but branch is baseBranch / detached /
#                        unclassifiable; ambiguous, keep the hard STOP.
#
# Exits non-zero (4) only on a usage/precondition error (missing args, $WT_ABS is
# not a git worktree) — a loud failure, never a silent misclassification.

set -uo pipefail

WT="${1:-}"
BASE="${2:-}"

if [ -z "$WT" ] || [ -z "$BASE" ]; then
  echo "orphan-detect: usage: orphan-detect.sh <WT_ABS> <baseBranch>" >&2
  exit 4
fi

if [ ! -d "$WT" ] || ! git -C "$WT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "orphan-detect: '$WT' is not a git worktree" >&2
  exit 4
fi

# Binding present → not an orphan; hand back to the normal mode-match logic.
if [ -f "$WT/.claude/active-project.json" ]; then
  echo "has-binding"
  exit 0
fi

# Binding absent: dirty tree means possible real work → keep the STOP.
if [ -n "$(git -C "$WT" status --porcelain)" ]; then
  echo "dirty-stop"
  exit 0
fi

# Binding absent + clean: the branch is the corroborating signal. A non-base,
# non-detached branch on the project's deterministic path is the orphan signature.
BRANCH="$(git -C "$WT" branch --show-current)"
if [ -z "$BRANCH" ] || [ "$BRANCH" = "$BASE" ]; then
  echo "foreign-stop"
  exit 0
fi

echo "orphan-recoverable"
exit 0
