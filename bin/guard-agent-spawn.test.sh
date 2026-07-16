#!/bin/sh
# Tests for guard-agent-spawn.py — depth cap, per-session budget, blocklist,
# fail-open. Hermetic: fake session trees under mktemp, HOME redirected so the
# blocklist path never touches the real one.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$DIR/guard-agent-spawn.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"
mkdir -p "$HOME/.claude"

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

# run <expect: allow|deny> <name> <json>
run() {
  out="$(printf '%s' "$3" | python3 "$GUARD")" ; rc=$?
  if [ "$1" = allow ]; then
    [ $rc -eq 0 ] && [ -z "$out" ] && ok "$2" || bad "$2 (rc=$rc out=$out)"
  else
    echo "$out" | grep -q '"permissionDecision": "deny"' && ok "$2" || bad "$2 (rc=$rc out=$out)"
  fi
}

# --- fixture: a session with a subagent tree ---------------------------------
SESS="$TMP/proj/sess-1"
SUB="$SESS/subagents"
mkdir -p "$SUB"
echo '{"agentType":"general-purpose","spawnDepth":1}' > "$SUB/agent-a1.meta.json"
echo '{"agentType":"general-purpose","spawnDepth":2}' > "$SUB/agent-a2.meta.json"
: > "$SUB/agent-a1.jsonl"
: > "$SUB/agent-a2.jsonl"
MAIN_T="$TMP/proj/sess-1.jsonl"; : > "$MAIN_T"

# 1. non-Agent tools are ignored
run allow "non-Agent tool ignored" \
  '{"tool_name":"Bash","tool_input":{"command":"ls"},"session_id":"sess-1","transcript_path":"'"$MAIN_T"'"}'

# 2. main loop (no agent_id) may spawn
run allow "main loop spawns freely" \
  '{"tool_name":"Agent","tool_input":{"prompt":"x"},"session_id":"sess-1","transcript_path":"'"$MAIN_T"'"}'

# 3. depth-1 caller may spawn (default max depth 2)
run allow "depth-1 subagent may fan out one level" \
  '{"tool_name":"Agent","tool_input":{"prompt":"x"},"session_id":"sess-1","agent_id":"a1","transcript_path":"'"$SUB/agent-a1.jsonl"'"}'

# 4. depth-2 caller is a leaf — denied
run deny "depth-2 subagent denied (cascade cap)" \
  '{"tool_name":"Agent","tool_input":{"prompt":"x"},"session_id":"sess-1","agent_id":"a2","transcript_path":"'"$SUB/agent-a2.jsonl"'"}'

# 5. Task alias covered too
run deny "Task tool name covered" \
  '{"tool_name":"Task","tool_input":{"prompt":"x"},"session_id":"sess-1","agent_id":"a2","transcript_path":"'"$SUB/agent-a2.jsonl"'"}'

# 6. unknown meta -> treated as depth 1 (still allowed one fan-out)
run allow "subagent with missing meta treated as depth 1" \
  '{"tool_name":"Agent","tool_input":{"prompt":"x"},"session_id":"sess-1","agent_id":"ghost","transcript_path":"'"$SUB/agent-ghost.jsonl"'"}'

# 7. env can tighten the depth cap to 1 (no nesting at all)
out="$(printf '%s' '{"tool_name":"Agent","tool_input":{},"session_id":"sess-1","agent_id":"a1","transcript_path":"'"$SUB/agent-a1.jsonl"'"}' | SPAWN_GUARD_MAX_DEPTH=1 python3 "$GUARD")"
echo "$out" | grep -q '"permissionDecision": "deny"' && ok "SPAWN_GUARD_MAX_DEPTH=1 forbids all nesting" || bad "SPAWN_GUARD_MAX_DEPTH=1 (out=$out)"

# 8. session budget: 2 metas exist, budget 2 -> main loop denied too
out="$(printf '%s' '{"tool_name":"Agent","tool_input":{},"session_id":"sess-1","transcript_path":"'"$MAIN_T"'"}' | SPAWN_GUARD_SESSION_BUDGET=2 python3 "$GUARD")"
echo "$out" | grep -q 'budget' && ok "per-session budget denies at the cap" || bad "budget deny (out=$out)"

# 9. budget is PER SESSION: a sibling session with its own empty tree is free
SESS2="$TMP/proj/sess-2"; mkdir -p "$SESS2/subagents"; : > "$TMP/proj/sess-2.jsonl"
out="$(printf '%s' '{"tool_name":"Agent","tool_input":{},"session_id":"sess-2","transcript_path":"'"$TMP/proj/sess-2.jsonl"'"}' | SPAWN_GUARD_SESSION_BUDGET=2 python3 "$GUARD")" ; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] && ok "parallel session has its own budget" || bad "sibling session budget (out=$out)"

# 10. blocklist: observer-flagged session denied outright
echo "sess-1" > "$HOME/.claude/spawn-guard.blocklist"
run deny "blocklisted session denied all spawning" \
  '{"tool_name":"Agent","tool_input":{},"session_id":"sess-1","transcript_path":"'"$MAIN_T"'"}'
rm "$HOME/.claude/spawn-guard.blocklist"

# 11. fail-open: garbage stdin allows
out="$(printf 'not json' | python3 "$GUARD")" ; rc=$?
[ $rc -eq 0 ] && [ -z "$out" ] && ok "garbage input fails open" || bad "fail-open (rc=$rc out=$out)"

echo "guard-agent-spawn: $pass passed, $fail failed"
[ $fail -eq 0 ] || exit 1
