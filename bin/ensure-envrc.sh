#!/usr/bin/env bash
# ~/.claude/bin/ensure-envrc.sh
# Ensure a worktree has a .envrc symlink to its main worktree's .envrc.
# Idempotent. No-op outside git, in main worktree, or if .envrc already exists.
# Safety (V-332): resolves the worktree path to ABSOLUTE and never force-overwrites an
# existing target, so a caller whose `cd` silently failed cannot clobber the real .envrc.
#
# Usage:
#   bash ~/.claude/bin/ensure-envrc.sh [<worktree-path>]
#
# When <worktree-path> is omitted, falls back to $PWD. The SessionStart hook
# uses the no-arg form (cwd is whatever Claude Code launched in); /next-ticket
# uses the explicit-path form because the new worktree may not be cwd yet.
#
# Idempotency: exits 0 silently if a .envrc already exists in the target
# (whether file or symlink). Output appears only when work was done.

set -u

WT="${1:-$PWD}"

# Resolve WT to an ABSOLUTE path up front (V-332). A relative WT makes the link name
# "$WT/.envrc" cwd-dependent — a caller whose `cd` silently failed could then aim the
# symlink at the MAIN checkout's real .envrc. An absolute path is immune to cwd; if the
# directory can't be resolved there's nothing to link, so no-op.
WT="$(cd "$WT" 2>/dev/null && pwd)" || exit 0
[ -n "$WT" ] || exit 0

# Need git to find the main worktree. `git worktree list` emits ABSOLUTE paths, so MAIN is
# already absolute — giving absolute paths on BOTH sides of the symlink (V-332).
MAIN=$(git -C "$WT" worktree list --porcelain 2>/dev/null \
       | awk '/^worktree / {print substr($0, 10); exit}')

# Not in a git tree → nothing to do.
[ -z "$MAIN" ] && exit 0

# Already in main worktree → main has its own real .envrc; don't symlink to self.
[ "$WT" = "$MAIN" ] && exit 0

# Refuse if the link target already exists — whatever it is (file, symlink, even a broken
# one): -e covers existing entries, -L also catches a dangling symlink. Idempotent no-op,
# and we NEVER clobber an existing .envrc (V-332 — the real file a `-f` force could destroy).
if [ -e "$WT/.envrc" ] || [ -L "$WT/.envrc" ]; then
  exit 0
fi

# Main has no .envrc → nothing to link.
[ -f "$MAIN/.envrc" ] || exit 0

# `ln -s` WITHOUT -f (V-332): a second backstop to the existence check above — even if that
# check were bypassed, ln refuses rather than force-overwriting the target.
ln -s "$MAIN/.envrc" "$WT/.envrc"
echo "envrc: symlinked $WT/.envrc -> $MAIN/.envrc"
