# Spawn guard — hard caps on subagent cascades

## The incident this exists for (2026-07-15)

A routed foreign model applied the pipeline's "spawn reviewers/verifiers" instructions at every
nesting level instead of acting as a leaf. One ticket job's spawn-depth census: **7 → 16 → 56 →
291 → 920** agents (depths 1–5, ~×4 branching per level), ~25k completions in one afternoon — a
weekly provider quota dead by 16:00. A second session ran the same shape against the Anthropic
monthly cap. The advisory guardrail (`pipeline/profiles/routed.md`, "cap fan-out hard") existed
and was ignored: **.md text is non-binding for models**. The only thing that stopped the cascade
was Claude Code's own non-configurable depth-5 ceiling.

Lesson: instructions advise; only tool-level enforcement blocks.

## The three layers

| Layer | File | Mechanism | Catches |
|---|---|---|---|
| In-band cap | `bin/guard-agent-spawn.py` | PreToolUse deny on `Agent`/`Task` | depth ≥ 2 spawns; session over budget; blocklisted sessions |
| Out-of-band watchdog | `bin/spawn-observer.py` (launchd, 60s) | filesystem census → blocklist | anything that bypasses hooks |
| Upstream budget | `claude-model-router` `guard` block | non-retryable 403 at the exit | whatever survives both, plus retry storms |

### guard-agent-spawn.py (PreToolUse)

Hooks fire inside subagents too, and a subagent's call carries `agent_id`; its
`agent-<id>.meta.json` (written by the harness) carries `spawnDepth`. The guard denies when:

- **depth** — the caller is already at `spawnDepth ≥ SPAWN_GUARD_MAX_DEPTH` (default **2**: the
  main loop spawns freely, a depth-1 agent may run one fan-out — e.g. a review panel — and
  depth-2+ agents are leaves);
- **budget** — the session's `subagents/` dir already holds `SPAWN_GUARD_SESSION_BUDGET`
  (default **60**) `agent-*.meta.json` files. Every depth lands flat in that one dir, so one
  counter caps the whole tree. **Per session** by design — parallel sessions each get their own;
- **blocklist** — the session id is in `~/.claude/spawn-guard.blocklist`.

Denials tell the model to finish inline and hand off; a *human* raises the env knobs for a
legitimately bigger run. Fails open on its own errors — a broken guard must not brick the tool.

### spawn-observer.py (watchdog)

Scans recently-active sessions' `subagents/` dirs each minute; a session crossing
`SPAWN_OBSERVER_MAX_AGENTS` (100) total or `SPAWN_OBSERVER_MAX_GROWTH` (30) new agents in one
interval is appended to the blocklist — the guard then denies all its further spawning (soft-stop:
in-flight work finishes, the tree stops widening). Yesterday's peak was 132 spawns/minute; either
threshold triggers inside one tick. Entries are never auto-removed; a human unblocks by editing
the file. Install: `bin/install-spawn-observer-launchd.sh`.

## Wiring

`settings.example.json` registers the hook under `PreToolUse` with matcher `Agent|Task`.
Tests: `bin/guard-agent-spawn.test.sh`, `bin/spawn-observer.test.sh`.
