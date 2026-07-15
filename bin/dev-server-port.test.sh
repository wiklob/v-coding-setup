#!/usr/bin/env bash
# dev-server-port.test.sh — empirical probes for V-396's wrong-worktree
# localhost guard. A listener rooted in another worktree must never be reused,
# while a listener rooted in the target worktree may be reused and reported.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/dev-server-port.sh"
BOX="$(mktemp -d)"
TARGET="$BOX/target-worktree"
OTHER="$BOX/other-worktree"
mkdir -p "$TARGET" "$OTHER"
TARGET="$(cd "$TARGET" && pwd -P)"
OTHER="$(cd "$OTHER" && pwd -P)"
PIDS=()
pass=0
fail=0

ok()  { printf 'ok   — %s\n' "$1"; pass=$((pass+1)); }
bad() { printf 'FAIL — %s\n' "$1"; fail=$((fail+1)); }
cleanup() {
  local pid
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$BOX"
}
trap cleanup EXIT

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

start_server() {
  local cwd="$1" port="$2"
  (cd "$cwd" && exec python3 -m http.server "$port" --bind 127.0.0.1 >"$BOX/server-$port.log" 2>&1) &
  local pid=$!
  PIDS+=("$pid")
  local i
  for i in $(seq 1 200); do
    lsof -nP -a -p "$pid" -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    sleep 0.05
  done
  printf 'fixture failed to listen on %s; server log:\n' "$port" >&2
  while IFS= read -r line; do printf '  %s\n' "$line" >&2; done < "$BOX/server-$port.log"
  return 1
}

requested="$(free_port)"
if ! start_server "$OTHER" "$requested"; then
  bad "fixture listener starts"
else
  selected="$($CHECK select "$TARGET" "$requested" 2>"$BOX/select.err")"
  if [ "$?" = 0 ] && [ "$selected" != "$requested" ]; then
    ok "foreign-worktree listener forces a distinct port"
  else
    bad "foreign listener should relocate (requested=$requested selected=${selected:-<none>})"
  fi

  if "$CHECK" verify "$TARGET" "$requested" >"$BOX/foreign.out" 2>&1; then
    bad "foreign-worktree listener must fail ownership verification"
  elif grep -Fq "$OTHER" "$BOX/foreign.out"; then
    ok "ownership failure names the serving worktree"
  else
    bad "ownership failure should name $OTHER"
  fi

  if start_server "$TARGET" "$selected"; then
    if served="$($CHECK verify "$TARGET" "$selected" 2>"$BOX/verify.err")" && [ "$served" = "$TARGET" ]; then
      ok "target-worktree listener passes and returns its cwd"
    else
      bad "target listener should verify (served=${served:-<none>})"
    fi

    reused="$($CHECK select "$TARGET" "$selected" 2>"$BOX/reuse.err")"
    if [ "$?" = 0 ] && [ "$reused" = "$selected" ]; then
      ok "target-owned listener may reuse its port"
    else
      bad "target-owned listener should be reusable (selected=$selected reused=${reused:-<none>})"
    fi
  else
    bad "target fixture listener starts"
  fi
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
