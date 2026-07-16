# Usage stats — retrieval + analysis reference

`/land-ticket` §8.5 writes a per-ticket JSON stats file at the end of every successful landing. This doc is the reference for finding, reading, and analyzing those files later.

## Where the data lives

Two layers, both local — never committed:

1. **Stats files** — `<repo>/.claude/usage-stats/<YYYY-MM-DD-HHMMSS>-<TICKET-ID>.json` — one per landed ticket, gitignored (the `.claude/usage-stats/` line is auto-appended to `.gitignore` on first write).
2. **Session transcripts** — `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` — full conversation per session, including every tool call and result. Stats files cross-reference these via `session_id` and `session_jsonl` fields.

To find a repo's stats: `ls <repo>/.claude/usage-stats/`. To find the source transcript for any stats file: `find ~/.claude/projects -name "$(jq -r .session_jsonl <stats>)"`.

### How the live transcript is located (resume-proof)

A `SessionStart` hook (`~/.claude/bin/capture-session.mjs`, wired in `~/.claude/settings.json`) records the harness's own `transcript_path` to a sidecar on every session start — and crucially **re-fires on resume/compact**, so the sidecar always points at the session's *current* `.jsonl` even after a context-resume rolled it to a new session id:

- `$CLAUDE_JOB_DIR/transcript.json` — per background job (no cross-session collision).
- `~/.claude/run/transcripts/<encoded-cwd>.json` — per cwd (interactive; latest start/resume wins).

`usage-stats.mjs` picks the **primary** session (whose totals are the headline) by identity, most-authoritative first: an explicit `--session`, then the capture-hook sidecars above, then id hints (`CLAUDE_CODE_SESSION_ID`, `state.resumeSessionId`, `state.sessionId`), and finally the V-26 resolver's **top content-matched** session (the session that mentions the ticket most). It no longer falls back to "newest `.jsonl` in the dir" — that was the bug that made CB-122 grab a co-resident session (V-1 Part 1). There is **no freshness/staleness gate** anymore: it rejected exactly the long/resumed lands §8.5 must support (V-1 Part 3); content-match makes recency irrelevant.

Separately, every **other** session that mentions the ticket (via the resolver, content-match) is **linked** under `related_sessions` — id, dir, mention count, timestamps — but **never summed into the headline**. The resolver ranks by mention count, and a famous-example ticket is referenced far beyond the sessions that worked on it (CB-144 content-matches ~67 sessions, not 4), so summing them would wildly over-count cost. The file therefore declares `"scope": "primary-session"` and links the siblings for manual audit (V-1 Part 2's sanctioned "land-only + link sibling ids" branch).

## Schema

```json
{
  "schema_version": 2,
  "repo": "myapp",
  "ticket": "CB-107",
  "pr": 52,                                  // number, or "none" for code-free landings
  "scope": "primary-session",                // headline totals cover the PRIMARY session only
  "session_id": "050004a7-2800-4670-...",   // the primary session (back-compat: top-level)
  "session_jsonl": "050004a7-2800-4670-...jsonl",
  "primary_source": "sidecar",               // how the primary was bound: session-flag | sidecar | id-hint | content-match-top
  "started_at": "2026-05-24T10:32:11Z",      // first assistant ts in the primary session
  "completed_at": "2026-05-24T10:58:35Z",   // ISO 8601 UTC
  "totals": {
    "input": 1269,                           // uncached input tokens (system + new user msg)
    "output": 81767,                         // assistant generation tokens
    "cache_read": 9359349,                   // cumulative context re-read from cache each turn
    "cache_create": 337050,                  // new tokens written into cache
    "assistant_msg_count": 132
  },
  "assistant_usage": [                       // every usage-bearing assistant message
    { "ordinal": 1, "timestamp": "2026-05-24T10:32:11Z", "command": "go",
      "model_id": "gpt-5.6-sol",            // exact message.model; null when absent
      "usage": { "input": 10, "output": 20, "cache_read": 30, "cache_create": 4 } }
  ],
  "usage_by_model": {                        // mixed-model aggregate of those records
    "gpt-5.6-sol": { "model_id": "gpt-5.6-sol", "totals": {
      "input": 10, "output": 20, "cache_read": 30, "cache_create": 4,
      "assistant_msg_count": 1
    } }
  },
  "billing_context": { "default_mode": "unknown", "model_overrides": {}, "source": "default" },
  "accounting": {
    "currency": "USD",
    "models": [{
      "observed_model": "gpt-5.6-sol", "provider": "openai", "canonical_model": "gpt-5.6-sol",
      "classification": "API-equivalent estimate", "estimate_usd": 0.001,
      "pricing": { "source_url": "https://openai.com/index/gpt-5-6/", "retrieved_at": "2026-07-15",
        "effective_at": "2026-07-09", "currency": "USD",
        "rates_per_million": { "input": 5, "output": 30, "cache_create": 6.25, "cache_read": 0.5 } }
    }]
  },
  "tool_calls": {                            // count per tool/MCP name (primary session)
    "Bash": 23,
    "Edit": 18,
    "mcp__linear__save_issue": 3,
    "Agent": 2,
    "Skill": 3
  },
  "compound_bash": 4,                        // Bash calls stapling steps with ` && ` (feeds V-4/V-15)
  "failed_calls": 2,                         // tool_result items flagged is_error
  "related_sessions": [                      // OTHER sessions mentioning the ticket — LINKED, not summed
    { "session_id": "e7900561-...", "project_dir": "-Users-...", "mentions": 75,
      "first_ts": "2026-05-28T09:00:00Z", "last_ts": "2026-05-28T09:40:00Z" }
  ]
}
```

`totals`/`tool_calls`/`session_id` stay top-level and cover the **primary session only**, so older JSON and token-only readers remain valid. Older files without `assistant_usage` are normalized as per-session deltas and remain model-unknown/unpriced. To audit the whole lifecycle, walk `related_sessions` (each `session_id` cross-references a transcript exactly like the primary); they are still linked, never summed.

### Billing classification

Pricing lives in `bin/usage-accounting.mjs` and resolves exact model IDs only. Every table includes provider, canonical model, official source URL, retrieval/effective date, currency, and all four token-category rates. A missing/unknown model or a table older than the 180-day freshness window is `unknown/unpriced`; it never inherits another model's price.

Billing context is explicit:

- `V_USAGE_BILLING_MODE=subscription|actual-api|unknown` — default for the session.
- `--billing-mode <mode>` — CLI override.
- Repeatable `--billing-model <exact-model-id>=<mode>` — per-model override for a mixed session.

Without configuration, a freshly priced model is an **API-equivalent estimate**, not an asserted bill. `actual-api` produces an **actual API estimate**; `subscription` reports **subscription usage — no token bill** and may retain the API-equivalent comparison. These classes and `unknown/unpriced` are never added into one invoice-like total.

## Recipes

All recipes assume `cd <repo>` first. Pipe through `jq -s` (slurp) to operate over all stats files at once.

### Per-ticket overview
```bash
# Show every ticket's headline numbers, newest first.
jq -s 'sort_by(.completed_at) | reverse | .[] | {
  ticket, pr, completed_at,
  out: .totals.output,
  cache_in: (.totals.cache_read + .totals.cache_create),
  msgs: .totals.assistant_msg_count
}' .claude/usage-stats/*.json
```

### Model-aware accounting
```bash
# All history, deduped across cumulative snapshots:
node bin/usage-report.mjs --json

# One day (allocation happens before filtering):
node bin/usage-report.mjs --date 2026-07-15 --json
```
The output keeps actual API estimates, API-equivalent estimates, subscription no-bill usage, and unknown/unpriced usage separate. Provider consoles remain billing-authoritative.

### Tool/MCP frequency across all tickets
```bash
# Which tools eat the most calls cumulatively? Useful for spotting "we hit save_issue 50 times this month".
jq -s '[.[] | .tool_calls | to_entries[]]
       | group_by(.key)
       | map({tool: .[0].key, total: (map(.value) | add)})
       | sort_by(-.total)' .claude/usage-stats/*.json
```

### Compare two tickets side-by-side
```bash
diff <(jq -S . .claude/usage-stats/*-CB-A.json) \
     <(jq -S . .claude/usage-stats/*-CB-B.json)
```

### Find the most expensive tickets (cache-read-heavy)
```bash
jq -s 'sort_by(-.totals.cache_read) | .[0:5] | .[] | {ticket, cache_read: .totals.cache_read, msgs: .totals.assistant_msg_count}' .claude/usage-stats/*.json
```

### Average tokens per assistant message (efficiency proxy)
```bash
jq -s 'map({ticket, avg_out: (.totals.output / .totals.assistant_msg_count)}) | sort_by(.avg_out) | reverse' .claude/usage-stats/*.json
```

## Cross-reference to the full transcript

The `session_id` and `session_jsonl` fields point at the raw conversation. Two common needs:

### Open the transcript for a stats file
```bash
STATS=.claude/usage-stats/2026-05-24-105835-CB-107.json
SID=$(jq -r .session_id "$STATS")
JSONL=$(find ~/.claude/projects -name "${SID}.jsonl" | head -1)
echo "$JSONL"
# Then explore with: less, jq -c '.[] | select(.type=="assistant")' "$JSONL", etc.
```

### From a stats file, list every Bash command that ran in that session
```bash
SID=$(jq -r .session_id "$STATS")
JSONL=$(find ~/.claude/projects -name "${SID}.jsonl" | head -1)
jq -r '. | select(.type=="assistant") | .message.content[]? | select(.type=="tool_use" and .name=="Bash") | .input.command' "$JSONL"
```
(Swap `"Bash"` for any tool name from the `tool_calls` map.)

### From a stats file, dump every user message + assistant response (for full audit)
```bash
SID=$(jq -r .session_id "$STATS")
JSONL=$(find ~/.claude/projects -name "${SID}.jsonl" | head -1)
jq -c '.' "$JSONL" | less
```

## Manual recovery (when `/land-ticket` §8.5 failed)

**First reach for the helper's own override** — it's almost always faster than hand-jq:

```bash
# Find the transcript by ticket content, then let the helper aggregate + write it.
grep -l "CB-XYZ" ~/.claude/projects/*/*.jsonl        # pick the one matching your run
node ~/.claude/bin/usage-stats.mjs --ticket CB-XYZ --pr <n> --session <session-id>
#   --session pins that transcript as the PRIMARY (overrides identity discovery). Other
#             sessions mentioning the ticket are still linked under related_sessions.
#   --dry-run  prints the payload and writes nothing — use it to confirm you picked the right id first.
# Often you don't even need --session: `--ticket CB-XYZ` alone content-matches the primary.
```

The hand-jq path below is the fallback when the helper itself is unavailable/broken, or you want to eyeball the raw numbers. You can reconstruct manually as long as the session's JSONL is on disk.

### 1. Find the right JSONL
```bash
# Search by ticket ID — the ID appears in tool inputs / messages during the session.
grep -l "CB-XYZ" ~/.claude/projects/*/*.jsonl | head -5
# Confirm by inspecting the file's `cwd` or timestamps; pick the one that matches when you ran /land-ticket.
JSONL=~/.claude/projects/<encoded>/<uuid>.jsonl
```

### 2. Aggregate the same totals
```bash
jq -s '[.[]|select(.type=="assistant")|.message.usage] | {
  input:(map(.input_tokens//0)|add),
  output:(map(.output_tokens//0)|add),
  cache_read:(map(.cache_read_input_tokens//0)|add),
  cache_create:(map(.cache_creation_input_tokens//0)|add),
  assistant_msg_count:length
}' "$JSONL"
```

### 3. Aggregate per-tool-call counts
```bash
jq -s '[.[]|select(.type=="assistant")|.message.content[]?|select(.type=="tool_use")|.name]
       | group_by(.) | map({key:.[0], value:length}) | from_entries' "$JSONL"
```

### 4. Compose the JSON manually and drop it in `.claude/usage-stats/`
Prefer the helper so record ordinals/model IDs are preserved. A hand-built legacy file containing the top-level fields above remains readable, but without `assistant_usage` it is deliberately model-unknown/unpriced. Use the session's actual `completed_at` (UTC) rather than "now" if backfilling.

## Failure modes + observability of the recovery itself

- **Stats file absent for a known ticket** → §8.5 now FAILS LOUD (exit 1, surfaced inline) rather than silently no-op'ing (V-1 Part 3) — so an absent file means the land run was interrupted before §8.5, or the primary genuinely couldn't be resolved (no sidecar, no id hint, and no session mentions the ticket). Re-derive with `--session` per above; if it recurs, debug discovery rather than reintroducing the old marker dance — see `feedback_bg_session_stats_discovery.md` for the structural reason the marker approach doesn't work.
- **Long/resumed land no longer aborts (fixed)** → a background job that is context-resumed/compacted keeps writing under a NEW session id. The old code trusted a frozen pointer and aborted on a >5-min freshness guard — the V-1/V-21 silent no-op. There is now **no freshness gate**: the primary binds via the resume-rewritten capture-hook sidecar (or content-match), so a >24h resume lands correctly. Recover anomalies with `--session`.
- **Stats over-count vs. expectation** → headline `totals` cover the **primary session only** by design (see `scope`). If you expected a whole-lifecycle sum, walk `related_sessions` and sum the ones that genuinely worked the ticket — they are deliberately not auto-summed because content-match over-includes incidental mentions.
- **`session_id` in stats doesn't match any JSONL on disk** → the transcript was deleted (`~/.claude/projects/...` is user-managed; some users prune older sessions). Cross-reference is broken; the stats file alone remains useful.
- **Multiple tickets in one session** → each land still writes a cumulative primary-session snapshot, but `usage-report.mjs` and `scorecard.mjs` allocate each `assistant_usage` ordinal once across files. Legacy files without ordinals use non-negative per-session deltas. Use those helpers rather than summing raw files.

## Housekeeping

- The `.claude/usage-stats/` folder grows indefinitely. To prune:
  ```bash
  # delete stats older than 90 days
  find .claude/usage-stats -name '*.json' -mtime +90 -delete
  ```
- Source JSONLs at `~/.claude/projects/` are larger (100 KB–1 MB each) and accumulate faster. They're independently prunable; just be aware that pruning a JSONL breaks the cross-reference for its stats file.
- Both layers are local-only. Neither is in git. Neither leaves the machine unless you ship it somewhere yourself.

## See also

- `~/.claude/commands/land-ticket.md` §8.5 — the writer (calls `usage-stats.mjs`; identity-bound primary + linked siblings + gitignore self-heal).
- `~/.claude/workflow-conventions.md` — the broader pipeline that produces these stats.
- [ccusage](https://github.com/ryoppippi/ccusage) — community CLI for daily token breakdowns across all sessions; complementary to the per-ticket stats here.
- [Claude Console Usage](https://platform.claude.com/usage) — billing-authoritative aggregate; what Anthropic actually charges you.
