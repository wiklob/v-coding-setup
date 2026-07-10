#!/usr/bin/env bash
# Bootstrap per-worktree Claude permissions.
#
# Runs as a SessionStart hook (configured in ~/.claude/settings.json).
# If $PWD is inside a Claude-managed worktree, drops a scoped
# settings.local.json into that worktree's .claude/ directory:
#   - allows Edit/Write/MultiEdit only under the worktree subtree
#   - denies edits of the settings file itself (Claude can't widen its scope)
# Idempotent — exits silently if the file already exists or cwd is not a worktree.

set -u

cwd="$PWD"
wt_root=""

# Walk up from $PWD looking for a worktree-shaped ancestor.
dir="$cwd"
while [[ "$dir" != "/" && -n "$dir" ]]; do
  base="$(basename "$dir")"
  parent="$(dirname "$dir")"
  parent_base="$(basename "$parent")"
  grandparent_base="$(basename "$(dirname "$parent")")"

  # Pattern 1: <repo-basename>-wt-<slug>/ that is itself a git worktree
  # (git worktrees have .git as a file pointing to ../main/.git/worktrees/<name>).
  if [[ "$base" == *-wt-* ]] && { [[ -f "$dir/.git" ]] || [[ -d "$dir/.git" ]]; }; then
    wt_root="$dir"
    break
  fi

  # Pattern 2: <repo>/.claude/worktrees/<name>/ (EnterWorktree-managed bg job).
  if [[ "$parent_base" == "worktrees" ]] && [[ "$grandparent_base" == ".claude" ]]; then
    wt_root="$dir"
    break
  fi

  dir="$parent"
done

[[ -z "$wt_root" ]] && exit 0

settings_file="$wt_root/.claude/settings.local.json"
[[ -f "$settings_file" ]] && exit 0

mkdir -p "$wt_root/.claude"

# V-36: JSON-escape the worktree path before embedding it in the settings JSON. A path
# containing a `"` or `\` would otherwise corrupt the file — or, with a crafted name,
# inject extra permission rules. `wt_esc` is the JSON-string body (surrounding quotes
# stripped), safe to interpolate inside the larger rule strings below. Falls back to the
# raw value if python3 is somehow unavailable, so a SessionStart hook never hard-fails.
wt_esc="$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1])[1:-1])' "$wt_root" 2>/dev/null)" || wt_esc="$wt_root"
[[ -z "$wt_esc" ]] && wt_esc="$wt_root"

cat > "$settings_file" <<EOF
{
  "_managed_by": "bootstrap-worktree-perms.sh",
  "_worktree_root": "$wt_esc",
  "permissions": {
    "allow": [
      "Edit($wt_esc/**)",
      "Write($wt_esc/**)",
      "MultiEdit($wt_esc/**)"
    ],
    "deny": [
      "Edit($wt_esc/.claude/settings.local.json)",
      "Write($wt_esc/.claude/settings.local.json)",
      "MultiEdit($wt_esc/.claude/settings.local.json)",
      "Edit($wt_esc/.claude/settings.json)",
      "Write($wt_esc/.claude/settings.json)",
      "MultiEdit($wt_esc/.claude/settings.json)"
    ]
  }
}
EOF

exit 0
