#!/usr/bin/env bash
# ~/.claude/bin/refresh-main-ff.test.sh
# Encoded proof for refresh-main-ff.sh's drift-preservation invariants (V-334,
# V-658). Builds isolated scratch repos (bare "origin" + a working clone) and
# asserts, against real git:
#
#   - a clean checkout just fast-forwards (no drift involved).
#   - PERMANENT drift on a file the incoming range never touches survives
#     untouched, and the ff still lands (V-334 baseline, unchanged).
#   - MODE-ONLY drift (working blob == HEAD's blob, only the mode bit
#     differs) on a file the incoming range DOES modify is discarded, not
#     restored — the working tree ends up equal to the new HEAD's blob
#     (V-658: this used to silently revert the landed content).
#
# Usage:  bash ~/.claude/bin/refresh-main-ff.test.sh   (exit 0 = all pass)

set -uo pipefail

BIN="$(cd "$(dirname "$0")" && pwd)"
HELPER="$BIN/refresh-main-ff.sh"
PASS=0
FAIL=0
ok()  { echo "  PASS: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/refresh-main-ff-test.XXXXXX")"
cleanup() { rm -rf "$SCRATCH"; }
trap cleanup EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
q() { "$@" >/dev/null 2>&1; }

# build_world <name> — a bare origin.git + a clone at $SCRATCH/<name>/main,
# both starting from one commit that adds f.txt (line1/line2/line3).
build_world() {
  local n="$1"
  local o="$SCRATCH/$n/origin.git" m="$SCRATCH/$n/main"
  q git init --bare -b main "$o"
  q git clone "$o" "$m"
  (
    cd "$m" || exit 1
    printf 'line1\nline2\nline3\n' > f.txt
    q git add f.txt && q git commit -m init && q git push -u origin main
  )
  echo "$m"
}

# advance <name> <editor-fn> — clone origin fresh, run editor-fn against it
# (which edits + commits f.txt), push. Simulates "someone else lands a PR".
advance() {
  local n="$1" fn="$2"
  local o="$SCRATCH/$n/origin.git" c="$SCRATCH/$n/other"
  q git clone "$o" "$c"
  ( cd "$c" || exit 1; "$fn"; q git push origin main )
}

echo "== refresh-main-ff.test =="

# ---------- 1. Clean checkout just fast-forwards ----------
M1="$(build_world clean)"
set_line3_v2() { printf 'line1\nline2\nline3-v2\n' > f.txt; git add f.txt; git commit -qm v2; }
advance clean set_line3_v2
OUT="$(bash "$HELPER" "$M1" main 2>&1)"
NEWHEAD="$(git -C "$SCRATCH/clean/origin.git" rev-parse main)"
[ "$(git -C "$M1" rev-parse HEAD)" = "$NEWHEAD" ] && ok "clean: fast-forwarded" || bad "clean: did not reach new HEAD: $OUT"
echo "$OUT" | grep -q "fast-forwarded" && ok "clean: reports fast-forward" || bad "clean: no fast-forward message: $OUT"

# ---------- 2. Permanent drift on an UNTOUCHED file survives (V-334 baseline) ----------
M2="$(build_world baseline)"
printf 'line1\nline2\nline3\nlocal-drift\n' > "$M2/f.txt"   # local content drift, untouched by the incoming commit
set_other_file() { echo other-content > other.txt; git add other.txt; git commit -qm other; }
advance baseline set_other_file
OUT="$(bash "$HELPER" "$M2" main 2>&1)"
NEWHEAD2="$(git -C "$SCRATCH/baseline/origin.git" rev-parse main)"
[ "$(git -C "$M2" rev-parse HEAD)" = "$NEWHEAD2" ] && ok "baseline: fast-forwarded despite drift" || bad "baseline: did not reach new HEAD: $OUT"
grep -q "local-drift" "$M2/f.txt" && ok "baseline: untouched-file drift survived" || bad "baseline: drift was lost!"
[ -f "$M2/other.txt" ] && ok "baseline: incoming new file present" || bad "baseline: incoming commit missing!"

# ---------- 3. MODE-ONLY drift on a file the incoming range MODIFIES (V-658) ----------
M3="$(build_world modeonly)"
chmod +x "$M3/f.txt"   # content identical to HEAD's blob, only the mode bit differs
set_line1_v2() { printf 'line1-V587-FIX\nline2\nline3\n' > f.txt; git add f.txt; git commit -qm v587; }
advance modeonly set_line1_v2
OUT="$(bash "$HELPER" "$M3" main 2>&1)"
NEWHEAD3="$(git -C "$SCRATCH/modeonly/origin.git" rev-parse main)"
WBLOB3="$(git -C "$M3" hash-object f.txt)"
HBLOB3="$(git -C "$M3" rev-parse "$NEWHEAD3:f.txt")"
[ "$(git -C "$M3" rev-parse HEAD)" = "$NEWHEAD3" ] && ok "mode-only: fast-forwarded" || bad "mode-only: did not reach new HEAD: $OUT"
[ "$WBLOB3" = "$HBLOB3" ] && ok "mode-only: working tree equals new HEAD blob (landed content NOT reverted)" || bad "mode-only: working tree diverged from new HEAD blob — V-658 regression! output: $OUT"

echo "== $PASS passed, $FAIL failed =="
[ "$FAIL" -eq 0 ]
