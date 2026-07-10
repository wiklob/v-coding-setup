---
description: Ingest a whole past conversation into context — resolves which transcript, renders it clean via the committed parser, reads the digest in. For pulling a prior security-investigation or self-improvement convo into the current session.
argument-hint: "[<session-id|path|preview-substring>] [--profile full|dialogue] [--full-tools]  (no arg → pick from a recent list)"
allowed-tools: Bash, Read
---

# /ingest-convo — pull a whole past conversation into context

The committed parser `~/.claude/scripts/ingest-convo.py` turns a session `.jsonl` into a clean
markdown digest (strips snapshots/reminders/base64, summarizes tool I/O, truncates long output).
**Never hand-roll a transcript parser** — use this script. If it's missing or broken, fix the
script, don't write a throwaway.

## Resolve which transcript

Parse `$ARGUMENTS`. The first non-flag token is the target.

- **No target** → run `python3 ~/.claude/scripts/ingest-convo.py --list -n 20`, show the table,
  and ask the user which index/id to ingest. (The current session is usually row 0 — skip it.)
- **Target given** → pass it straight through; the script resolves a path, a session-id prefix,
  or a preview substring (most-recent wins; ambiguous → it lists candidates, re-ask).

## Render + ingest

1. Pick the profile from flags (default `full`):
   - `full` (default) — user/assistant text + tool calls & results summarized. Use for security
     investigations where *what was done* matters.
   - `--profile dialogue` — text only, tools dropped. Smallest; use when only the discussion matters.
   - `--full-tools` → pass `--tools full` (already the default in `full`); `--profile dialogue`
     overrides to no tools.
   - Note: `--profile thinking` exists but **stored transcripts redact thinking text** (signature
     only), so it currently yields nothing — don't reach for it.
2. Write the digest to a file, then Read it (so it actually lands in context):
   ```
   out="${CLAUDE_JOB_DIR:-/tmp}/tmp/ingest-$(basename TARGET).md"   # or just /tmp/ingest-X.md
   mkdir -p "$(dirname "$out")"
   python3 ~/.claude/scripts/ingest-convo.py <target> --profile <p> --out "$out"
   ```
   The script prints char/line count to stderr. Then `Read` the file. If it's very large
   (>~6k lines), Read in offset chunks rather than truncating.
3. Briefly confirm what was ingested (which convo, how big), then proceed with the user's actual
   task using that context.

## Notes

- Searches **all** projects under `~/.claude/projects/`, not just the current one — security convos
  may live elsewhere.
- Tune noise with `--max-tool-lines N` / `--max-tool-chars N` (defaults 40 / 4000) and
  `--no-sidechains` to drop subagent transcripts.
