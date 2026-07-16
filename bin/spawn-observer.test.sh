#!/bin/sh
# Tests for spawn-observer.py — absolute cap, growth cap, active-window filter,
# blocklist dedupe. Hermetic: fake projects root + blocklist + state under mktemp.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
OBS="$DIR/spawn-observer.py"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export SPAWN_OBSERVER_ROOT="$TMP/projects"
export SPAWN_OBSERVER_JOBS="$TMP/jobs"
export SPAWN_OBSERVER_BLOCKLIST="$TMP/blocklist"
export SPAWN_OBSERVER_STATE="$TMP/state.json"
export SPAWN_OBSERVER_MAX_AGENTS=10
export SPAWN_OBSERVER_MAX_GROWTH=5
export SPAWN_OBSERVER_ACTIVE_MINUTES=30
export SPAWN_OBSERVER_PARK_STRIKES=3
export SPAWN_OBSERVER_PARK_WINDOW_MIN=60
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

# --- job parking --------------------------------------------------------------
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
mkjob() { # mkjob <id> <state> <detail> <strikes>
  d="$SPAWN_OBSERVER_JOBS/$1"; mkdir -p "$d"
  printf '{"state":"%s","tempo":"%s","detail":"%s","respawnFlags":[]}' "$2" "$2" "$3" > "$d/state.json"
  : > "$d/timeline.jsonl"
  i=0; while [ $i -lt "$4" ]; do
    printf '{"at":"%s","state":"blocked","detail":"%s"}\n' "$NOW_ISO" "$3" >> "$d/timeline.jsonl"
    i=$((i+1))
  done
}

# 6. blocked on a provider limit with 3 recent strikes -> parked (state done, backup kept)
mkjob j-limited blocked "API Error: All credentials for model gpt-x are cooling down" 3
python3 "$OBS" >/dev/null
s="$(python3 -c "import json;print(json.load(open('$SPAWN_OBSERVER_JOBS/j-limited/state.json'))['state'])")"
[ "$s" = done ] && [ -f "$SPAWN_OBSERVER_JOBS/j-limited/state.json.parked.bak" ] \
  && ok "provider-limited job parked with backup" || bad "park limited job (state=$s)"

# 7. blocked on an ordinary error -> untouched
mkjob j-normal blocked "TypeError: cannot read properties of undefined" 5
python3 "$OBS" >/dev/null
s="$(python3 -c "import json;print(json.load(open('$SPAWN_OBSERVER_JOBS/j-normal/state.json'))['state'])")"
[ "$s" = blocked ] && ok "non-limit block untouched" || bad "non-limit block parked (state=$s)"

# 8. limit error but below the strike threshold -> untouched
mkjob j-early blocked "rate_limit_error: weekly usage limit reached" 2
python3 "$OBS" >/dev/null
s="$(python3 -c "import json;print(json.load(open('$SPAWN_OBSERVER_JOBS/j-early/state.json'))['state'])")"
[ "$s" = blocked ] && ok "below strike threshold untouched" || bad "early park (state=$s)"

# 9. working jobs never parked
mkjob j-working working "all good" 0
python3 "$OBS" >/dev/null
s="$(python3 -c "import json;print(json.load(open('$SPAWN_OBSERVER_JOBS/j-working/state.json'))['state'])")"
[ "$s" = working ] && ok "working job untouched" || bad "working job parked (state=$s)"

echo "spawn-observer: $pass passed, $fail failed"
[ $fail -eq 0 ] || exit 1
