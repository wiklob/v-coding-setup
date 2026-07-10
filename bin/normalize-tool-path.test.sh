#!/usr/bin/env bash
# Regression test for bin/normalize-tool-path.py (V-277).
# The hook cannot be live-exercised in the session that authors it (the running session's
# hooks load from ~/.claude/settings.json, not the worktree copy), so this is the executable
# proof: it pipes the real PreToolUse stdin contract into the hook and asserts the rewrite
# decision. Self-contained — builds its own fixtures in a temp dir, cleans up on exit.
set -u
HOOK="$(cd "$(dirname "$0")" && pwd)/normalize-tool-path.py"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

mkdir -p "$T/(app)" "$T/[id]"
printf 'x\n' > "$T/(app)/probe.txt"
printf 'x\n' > "$T/[id]/page.txt"
printf 'x\n' > "$T/lit\\(paren.txt"      # a file whose real name contains a backslash

pass=0 fail=0
# $1 label  $2 json-on-stdin  $3 expected file_path in updatedInput, or "NOOP" for no rewrite
check() {
  local out; out="$(printf '%s' "$2" | python3 "$HOOK")"
  local got
  if [ -z "$out" ]; then got="NOOP"
  else got="$(printf '%s' "$out" | python3 -c 'import sys,json; print(json.load(sys.stdin)["hookSpecificOutput"]["updatedInput"]["file_path"])')"; fi
  if [ "$got" = "$3" ]; then pass=$((pass+1)); printf 'ok   %s\n' "$1"
  else fail=$((fail+1)); printf 'FAIL %s\n      want=%s\n      got =%s\n' "$1" "$3" "$got"; fi
}

check "escaped (app) existing -> rewrite" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$T/\\\\(app\\\\)/probe.txt\"}}" \
  "$T/(app)/probe.txt"
check "literal (app) existing -> noop" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$T/(app)/probe.txt\"}}" "NOOP"
check "escaped [id] existing -> rewrite" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$T/\\\\[id\\\\]/page.txt\"}}" \
  "$T/[id]/page.txt"
check "escaped but missing -> noop" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$T/\\\\(nope\\\\)/x.txt\"}}" "NOOP"
check "real backslash file (exists as-given) -> noop (no corruption)" \
  "{\"tool_name\":\"Read\",\"tool_input\":{\"file_path\":\"$T/lit\\\\(paren.txt\"}}" "NOOP"
check "Write new into escaped existing dir -> rewrite" \
  "{\"tool_name\":\"Write\",\"tool_input\":{\"file_path\":\"$T/\\\\(app\\\\)/new.txt\",\"content\":\"x\"}}" \
  "$T/(app)/new.txt"
check "Bash out of scope -> noop" \
  "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls $T/\\\\(app\\\\)\"}}" "NOOP"

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
