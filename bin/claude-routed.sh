#!/bin/sh
# claude-routed — launch Claude Code on a routed (proxied non-Anthropic) model
# with the context-economy env the harness cannot apply per-model by itself.
#
# Why: for a custom model id the harness can't learn the real context window
# (gateway discovery reads only id/display_name) and auto-compact is unreliable
# — the 2026-07-15 incident ran a main frame to 371k/200k (186%), past where
# /compact can still execute (V-387). Through a translating proxy there is no
# working prompt caching either, so every oversized frame is re-billed each
# turn. CLAUDE_CODE_AUTO_COMPACT_WINDOW shrinks the effective window so
# compaction fires early. See pipeline/profiles/routed.md §Launching.
#
# Usage: claude-routed.sh --model gpt-5.6-sol [any other claude args]
#        CLAUDE_CODE_AUTO_COMPACT_WINDOW=120000 claude-routed.sh ...  (override)

CLAUDE_CODE_AUTO_COMPACT_WINDOW="${CLAUDE_CODE_AUTO_COMPACT_WINDOW:-150000}" \
  exec claude "$@"
