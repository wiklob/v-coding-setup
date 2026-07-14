#!/usr/bin/env bash
# Scrub gate — CI probe that the published tree carries no personal/machine/infra
# strings from the source setup this repo was extracted from. The empirical check
# behind the "history reveals no secrets, tree reveals no identity" launch promise
# (verify the invariant, don't trust artifact presence).
#
# Two tiers:
#   HARD  — never allowed anywhere in the tree.
#   SOFT  — the bare author handle: allowed only in LICENSE, README.md (repo
#           links), and docs/plan.md (the build plan documents the extraction),
#           and only as part of a github.com/<handle>/ URL, the @<handle>/ npm
#           scope of the sibling claude-model-router package, or the copyright line.
#
# Self-exclusion: this file (it names the strings it hunts). docs/plan.md is
# hard-tier scanned like everything else (its scrub-list section was sanitized
# to placeholders); it stays soft-exempt for the bare handle (license row,
# source-repo link).
#
# Usage:  bash .github/scrub-gate.sh   (from the repo root)
# Exit:   0 = clean, 1 = hits found, 2 = probe error.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

HARD=(
  "178.104.140.96"
  "wiklob.dev"
  "linear.app/wiklob"
  "com.wiklob.claude"
  "/Users/wiklob"
  "cbapp"
  "carteblanche"
  "Carte Blanche"
  "Wiktor"
  "minter_recoil"
)

fail=0

for s in "${HARD[@]}"; do
  hits="$(grep -rniF --exclude-dir=.git --exclude=.git --exclude=scrub-gate.sh -e "$s" . 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    echo "SCRUB HIT (hard) — '$s':"
    printf '%s\n' "$hits"
    fail=1
  fi
done

# SOFT tier: bare handle outside the allowlisted files/shapes.
soft_hits="$(grep -rniF --exclude-dir=.git --exclude=.git -e "wiklob" . 2>/dev/null \
  | grep -v '^\./LICENSE:' \
  | grep -v '^\./README.md:' \
  | grep -v '^\./docs/plan.md:' \
  | grep -v '^\./\.github/scrub-gate.sh:' \
  | grep -v 'github\.com/wiklob/' \
  | grep -v '@wiklob/claude-model-router' || true)"
if [ -n "$soft_hits" ]; then
  echo "SCRUB HIT (soft — bare handle outside LICENSE/README/docs/plan.md):"
  printf '%s\n' "$soft_hits"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: scrub gate clean."
fi
exit "$fail"
