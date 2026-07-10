#!/usr/bin/env bash
# Regression probe for V-62 — the worktree-local active-project.json allow rule.
#
# settings.json grants:
#   Write($HOME/-claude-wt-*/.claude/active-project.json)
# so a /go or /next-ticket session no longer trips the built-in sensitive-file
# prompt when it writes its worktree-local binding marker. This probe asserts
# the rule's SCOPE: it must match the worktree active-project.json path and must
# NEVER match the global ~/.claude config (protection of ~/.claude stays intact).
#
# This is the encoded proof of the negative for V-62's `invariant` acceptance
# item — presence of the allow line alone proves nothing about what it excludes.
#
# Note: the literal prefix `$HOME/-claude-wt-` cannot match
# `$HOME/.claude/...` (`.claude` != `-claude-wt-`), so the global config
# is structurally excluded regardless of how `*` is interpreted.

set -euo pipefail

pat="$HOME/-claude-wt-*/.claude/active-project.json"

should_match=(
  "$HOME/-claude-wt-v-62/.claude/active-project.json"
  "$HOME/-claude-wt-some-feature-slug/.claude/active-project.json"
)

# Global ~/.claude config + non-binding worktree files must NOT match
# (least privilege: only active-project.json under a worktree is whitelisted).
should_not_match=(
  "$HOME/.claude/settings.json"
  "$HOME/.claude/active-project.json"
  "$HOME/.claude/projects/foo/bar.jsonl"
  "$HOME/-claude-wt-v-62/.claude/settings.json"
  "$HOME/-claude-wt-v-62/.claude/settings.local.json"
)

fail=0
for p in "${should_match[@]}"; do
  [[ $p == $pat ]] || { echo "FAIL: should match but did not: $p"; fail=1; }
done
for p in "${should_not_match[@]}"; do
  [[ $p == $pat ]] && { echo "FAIL: must NOT match (global/config leak): $p"; fail=1; }
done

if [[ $fail -eq 0 ]]; then
  echo "PASS: worktree active-project.json allowed; global ~/.claude NOT matched"
fi
exit $fail
