#!/bin/sh
# Tests for spawn-observer.py — absolute cap, growth cap, active-window filter,
# blocklist dedupe. Hermetic: fake projects root + blocklist + state under mktemp.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
OBS="$DIR/spawn-observer.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export SPAWN_OBSERVER_ROOT="$TMP/projects"
export SPAWN_OBSERVER_BLOCKLIST="$TMP/blocklist"
export SPAWN_OBSERVER_STATE="$TMP/state.json"
export SPAWN_OBSERVER_MAX_AGENTS=10
export SPAWN_OBSERVER_MAX_GROWTH=5
export SPAWN_OBSERVER_ACTIVE_MINUTES=30
PATH_NO_OSASCRIPT="$TMP/nobin"; mkdir -p "$PATH_NO_OSASCRIPT"   # keep notifications quiet

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

mksess() { # mksess <proj> <sess> <agents> [old]
  d="$SPAWN_OBSERVER_ROOT/$1/$2/subagents"; mkdir -p "$d"
  i=0; while [ $i -lt "$3" ]; do echo '{}' > "$d/agent-x$i.meta.json"; i=$((i+1)); done
  : > "$SPAWN_OBSERVER_ROOT/$1/$2.jsonl"
  [ "${4:-}" = old ] && touch -t 202601010000 "$SPAWN_OBSERVER_ROOT/$1/$2.jsonl"
}

# 1. absolute cap: 12 agents >= 10 -> blocked
mksess p1 sess-big 12
python3 "$OBS" >/dev/null
grep -q '^sess-big$' "$SPAWN_OBSERVER_BLOCKLIST" 2>/dev/null && ok "absolute cap blocks" || bad "absolute cap"

# 2. small active session untouched
mksess p1 sess-small 3
python3 "$OBS" >/dev/null
grep -q '^sess-small$' "$SPAWN_OBSERVER_BLOCKLIST" 2>/dev/null && bad "small session wrongly blocked" || ok "small session untouched"

# 3. growth cap: 3 -> 9 (+6 >= 5) between runs -> blocked
i=3; while [ $i -lt 9 ]; do echo '{}' > "$SPAWN_OBSERVER_ROOT/p1/sess-small/subagents/agent-x$i.meta.json"; i=$((i+1)); done
python3 "$OBS" >/dev/null
grep -q '^sess-small$' "$SPAWN_OBSERVER_BLOCKLIST" && ok "growth cap blocks a burst" || bad "growth cap"

# 4. inactive (old transcript) sessions are skipped even when huge
mksess p2 sess-stale 50 old
python3 "$OBS" >/dev/null
grep -q '^sess-stale$' "$SPAWN_OBSERVER_BLOCKLIST" 2>/dev/null && bad "stale session wrongly blocked" || ok "inactive session skipped"

# 5. no duplicate blocklist entries on repeat runs
python3 "$OBS" >/dev/null
n=$(grep -c '^sess-big$' "$SPAWN_OBSERVER_BLOCKLIST")
[ "$n" -eq 1 ] && ok "no duplicate entries" || bad "duplicates: $n"

echo "spawn-observer: $pass passed, $fail failed"
[ $fail -eq 0 ] || exit 1
