#!/usr/bin/env bash
# Regression probe for V-74 — no command cd's into a nonexistent hardcoded repo path.
#
# Harvested bug (hook:cd-missing-repo-path): command sessions generated bash that
# `cd`'d into local checkout paths that don't exist on this machine —
#   cd ~/<repo-name> && gh pr view …      (the repo's GitHub slug is
#                                          `<owner>/<repo-name>`, but there is NO
#                                          local checkout at ~/<repo-name>)
#   cd ~ && git log …                     (home is not a git repository)
# both fail immediately ("no such file or directory" / "not a git repository").
#
# THE RULE (authoring guidance — also enforced below):
#   - Resolve the repo root from config / the running tree, never from the
#     GitHub slug. Use `root="$(git rev-parse --show-toplevel)"` (or, in a
#     ticket worktree, the established `$WT_ABS`) and verify it exists before use.
#   - To inspect ~/.claude git history, use `git -C ~/.claude …` — never
#     `cd ~ && git …`.
#   - Never derive a local filesystem path from the GitHub slug.
#
# This is the encoded proof of the negative for V-74's `invariant` acceptance
# item: it asserts the bad pattern is ABSENT from the executable-instruction
# surfaces (commands/ + bin/), and self-tests the detector so a green run is
# meaningful. Presence of "good" root-resolution lines elsewhere proves nothing
# about the absence of the bad ones — only this scan does.
#
# Usage:  bash bin/check-no-hardcoded-repo-cd.sh
# Exit:   0 = PASS (invariant holds), 1 = FAIL (offenders printed), 2 = probe error.

set -euo pipefail

# Repo root = parent of this script's dir (bin/ sits directly under root).
# Derived from the script's own location, so it is correct from any cwd and is
# guaranteed to exist (the script ran from it) — the verify-before-use the
# acceptance asks for, applied to the probe itself.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# The slug-derived repo name comes from the checkout's ticket-flow config (same
# derivation guard-repo-cd.py uses at runtime); default to "v" when absent so the
# probe still guards the bare `cd $HOME` case with a plausible repo name.
REPO_NAME="$(python3 -c '
import json, sys
try:
    print(json.load(open(sys.argv[1])).get("repo", "").split("/")[-1].strip() or "v")
except Exception:
    print("v")
' "$ROOT/.claude/ticket-flow.json")"

# Regex-escape $HOME (covers dots and other metacharacters in the path).
HOME_RE="$(printf '%s' "$HOME" | sed -e 's/[][\/.^$*+?(){}|\\]/\\&/g')"
NAME_RE="$(printf '%s' "$REPO_NAME" | sed -e 's/[][\/.^$*+?(){}|\\]/\\&/g')"

# A `cd` whose target is exactly $HOME or $HOME/<repo-name> (optionally quoted),
# bounded so longer valid paths ($HOME/.claude, $HOME/-claude-wt-*, $HOME/Downloads)
# do NOT match.
PATTERN="(^|[^[:alnum:]_/])cd[[:space:]]+[\"']?${HOME_RE}(/${NAME_RE})?([[:space:]\"'&|;)]|\$)"

fail=0

# --- 1. Self-test the detector: bad lines must match, good lines must not. ---
should_match=(
  "cd $HOME/$REPO_NAME && gh pr view 52"
  "cd $HOME && git log"
  "cd \"$HOME/$REPO_NAME\""
  "  cd $HOME;"
)
should_not_match=(
  "cd $HOME/.claude"
  "git -C $HOME/.claude log"
  "cd $HOME/-claude-wt-v-74"
  "cd $HOME/projects/other-checkout"
  'root="$(git rev-parse --show-toplevel)"'
)

for s in "${should_match[@]}"; do
  if ! printf '%s\n' "$s" | grep -qE "$PATTERN"; then
    echo "PROBE BUG: detector missed a bad line: $s"; exit 2
  fi
done
for s in "${should_not_match[@]}"; do
  if printf '%s\n' "$s" | grep -qE "$PATTERN"; then
    echo "PROBE BUG: detector false-positived a good line: $s"; exit 2
  fi
done

# --- 2. Scan the executable-instruction surfaces for real offenders. ---
# commands/*.md (instructions Claude executes) + bin/* scripts, as they exist
# ON DISK (find, not `git ls-files` — a freshly-added command isn't tracked yet
# but its bad cd is still a bug). Exclude the small set of files that legitimately
# EMBED the bad pattern as data, not as an instruction to run: this probe itself
# and the V-337 runtime guard + its test (guard-repo-cd.py rewrites the pattern at
# runtime, so it must carry it as detector/doc; its .test.sh carries it as fixtures).
allow_embed=(
  "check-no-hardcoded-repo-cd.sh"   # this probe (self-test data)
  "guard-repo-cd.py"                # V-337 runtime rewrite guard (detector + doc)
  "guard-repo-cd.test.sh"           # V-337 guard's regression fixtures
)
is_allowed() {
  local b; b="$(basename "$1")"
  local a; for a in "${allow_embed[@]}"; do [[ "$b" == "$a" ]] && return 0; done
  return 1
}
mapfile -t files < <(
  find "$ROOT/commands" -type f -name '*.md' 2>/dev/null
  find "$ROOT/bin" -type f 2>/dev/null
)

hits=0
for f in "${files[@]}"; do
  is_allowed "$f" && continue
  while IFS= read -r line; do
    echo "OFFENDER: ${f#"$ROOT"/}:$line"
    hits=1
  done < <(grep -nE "$PATTERN" "$f" || true)
done

if [[ $hits -ne 0 ]]; then
  echo "FAIL: command/bin source cd's into a hardcoded nonexistent repo path (V-74)."
  echo "Resolve root via 'git rev-parse --show-toplevel' / \$WT_ABS, or use 'git -C ~/.claude …'."
  exit 1
fi

echo "PASS: no command/bin source cd's into \$HOME or \$HOME/$REPO_NAME (V-74 invariant holds)."
exit 0
