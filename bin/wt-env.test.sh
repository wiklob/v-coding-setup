#!/bin/sh
# Tests for wt-env — .envrc sourcing (V-435) and the python/python3 -> repo
# .venv resolution (V-523). Hermetic: fake project dir + fake interpreters
# under mktemp, no real .envrc or venv touched.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER="$DIR/wt-env"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  ok  $1"; }
bad() { fail=$((fail+1)); echo "FAIL  $1"; }

# 1. .envrc is sourced (auto-exporting) before the command runs.
PROJ1="$TMP/proj-envrc"
mkdir -p "$PROJ1"
printf 'export WT_ENV_TEST_VAR=from-envrc\n' > "$PROJ1/.envrc"
out="$(cd "$PROJ1" && "$HELPER" sh -c 'echo "$WT_ENV_TEST_VAR"' 2>&1)"
if [ "$out" = "from-envrc" ]; then
  ok ".envrc is sourced before the wrapped command runs"
else
  bad ".envrc is sourced before the wrapped command runs (got: $out)"
fi

# 2. No .envrc -> warns on stderr but still runs the command.
PROJ2="$TMP/proj-no-envrc"
mkdir -p "$PROJ2"
out="$(cd "$PROJ2" && "$HELPER" echo hello 2>&1)"
case "$out" in
  *"no ./.envrc"*"hello"*) ok "missing .envrc warns but still execs the command" ;;
  *) bad "missing .envrc warns but still execs the command (got: $out)" ;;
esac

# 3. python3 resolves to ./.venv/bin/python when present.
PROJ3="$TMP/proj-venv"
mkdir -p "$PROJ3/.venv/bin"
: > "$PROJ3/.envrc"
printf '#!/bin/sh\necho venv-python "$@"\n' > "$PROJ3/.venv/bin/python"
chmod +x "$PROJ3/.venv/bin/python"
out="$(cd "$PROJ3" && "$HELPER" python3 --probe 2>&1)"
if [ "$out" = "venv-python --probe" ]; then
  ok "python3 resolves to ./.venv/bin/python when the venv exists"
else
  bad "python3 resolves to ./.venv/bin/python when the venv exists (got: $out)"
fi

# 4. python (not just python3) resolves the same way.
out="$(cd "$PROJ3" && "$HELPER" python --probe 2>&1)"
if [ "$out" = "venv-python --probe" ]; then
  ok "python also resolves to ./.venv/bin/python when the venv exists"
else
  bad "python also resolves to ./.venv/bin/python when the venv exists (got: $out)"
fi

# 5. No .venv -> falls back to PATH's python3, not a hard failure.
PROJ4="$TMP/proj-no-venv"
mkdir -p "$PROJ4" "$TMP/fakebin"
: > "$PROJ4/.envrc"
printf '#!/bin/sh\necho path-python "$@"\n' > "$TMP/fakebin/python3"
chmod +x "$TMP/fakebin/python3"
out="$(cd "$PROJ4" && PATH="$TMP/fakebin:$PATH" "$HELPER" python3 --probe 2>&1)"
if [ "$out" = "path-python --probe" ]; then
  ok "python3 falls back to PATH when no ./.venv/bin/python exists"
else
  bad "python3 falls back to PATH when no ./.venv/bin/python exists (got: $out)"
fi

# 6. Non-python commands are passed through unresolved.
out="$(cd "$PROJ3" && "$HELPER" echo unrelated-cmd 2>&1)"
if [ "$out" = "unrelated-cmd" ]; then
  ok "non-python commands pass through unresolved"
else
  bad "non-python commands pass through unresolved (got: $out)"
fi

echo "wt-env: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
