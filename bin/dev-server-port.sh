#!/usr/bin/env bash
# dev-server-port.sh — select a dev-server port that is not owned by another
# worktree, then verify the listener's cwd before a pipeline claims it is live.

set -euo pipefail

usage() {
  printf 'usage: %s <select|verify> <worktree-root> <port>\n' "${0##*/}" >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
mode="$1"
worktree="$2"
port="$3"

command -v lsof >/dev/null 2>&1 || {
  printf 'error: lsof is required to inspect dev-server listener ownership\n' >&2
  exit 2
}
[ -d "$worktree" ] || {
  printf 'error: worktree root not found: %s\n' "$worktree" >&2
  exit 2
}
case "$port" in
  ''|*[!0-9]*) printf 'error: port must be numeric: %s\n' "$port" >&2; exit 2 ;;
esac
[ "$port" -ge 1 ] && [ "$port" -le 65535 ] || {
  printf 'error: port out of range: %s\n' "$port" >&2
  exit 2
}

worktree="$(cd "$worktree" && pwd -P)"

listener_cwds() {
  local candidate="$1" pid cwd
  local pids=()
  while IFS= read -r pid; do
    [ -n "$pid" ] && pids+=("$pid")
  done < <(lsof -nP -iTCP:"$candidate" -sTCP:LISTEN -Fp 2>/dev/null | sed -n 's/^p//p' | sort -u)

  for pid in "${pids[@]}"; do
    cwd="$(lsof -nP -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    if [ -n "$cwd" ]; then
      printf '%s\n' "$cwd"
    else
      printf '<unknown cwd for pid %s>\n' "$pid"
    fi
  done
}

is_inside_worktree() {
  case "$1" in
    "$worktree"|"$worktree"/*) return 0 ;;
    *) return 1 ;;
  esac
}

port_state() {
  local candidate="$1" cwd saw=0 foreign=0
  while IFS= read -r cwd; do
    [ -n "$cwd" ] || continue
    saw=1
    is_inside_worktree "$cwd" || foreign=1
  done < <(listener_cwds "$candidate")

  if [ "$saw" -eq 0 ]; then
    printf 'free\n'
  elif [ "$foreign" -eq 0 ]; then
    printf 'owned\n'
  else
    printf 'foreign\n'
  fi
}

select_port() {
  local requested="$1" state candidate start offset
  state="$(port_state "$requested")"
  if [ "$state" != foreign ]; then
    printf '%s\n' "$requested"
    return 0
  fi

  printf 'port %s is served by another worktree; selecting a distinct port\n' "$requested" >&2
  start=$((3100 + $(printf '%s' "$worktree" | cksum | cut -d ' ' -f 1) % 700))
  for offset in $(seq 0 699); do
    candidate=$((3100 + (start - 3100 + offset) % 700))
    [ "$candidate" -eq "$requested" ] && continue
    state="$(port_state "$candidate")"
    if [ "$state" != foreign ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  printf 'error: no free or target-owned dev-server port found in 3100-3799\n' >&2
  return 1
}

verify_port() {
  local candidate="$1" cwd saw=0 foreign=0 served=''
  while IFS= read -r cwd; do
    [ -n "$cwd" ] || continue
    saw=1
    if is_inside_worktree "$cwd"; then
      [ -n "$served" ] || served="$cwd"
    else
      foreign=1
      printf 'foreign listener cwd on port %s: %s\n' "$candidate" "$cwd" >&2
    fi
  done < <(listener_cwds "$candidate")

  if [ "$saw" -eq 0 ]; then
    printf 'error: no listening process found on port %s\n' "$candidate" >&2
    return 1
  fi
  if [ "$foreign" -ne 0 ] || [ -z "$served" ]; then
    printf 'error: port %s is not served exclusively from worktree %s\n' "$candidate" "$worktree" >&2
    return 1
  fi

  printf '%s\n' "$served"
}

case "$mode" in
  select) select_port "$port" ;;
  verify) verify_port "$port" ;;
  *) usage ;;
esac
