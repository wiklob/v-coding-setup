# v-coding-setup

An autonomous AI dev pipeline built on **Claude Code** — slash-command skills, permission guards and hooks, scheduled rituals, a Linear-backed ticket flow, and a markdown-in-git knowledge base. Extracted from a private setup that built itself over ~760 commits of dogfooding: the pipeline's own tickets are planned, scoped, built, reviewed, and landed *by the pipeline*.

> **Status: pre-1.0, freshly extracted.** The engine is battle-tested in its original home; this packaging (installer, docs, defaults) is new. Expect rough edges — file issues.

## What it is

The pipeline maps software work onto a **V-model**:

- **Left wing — where good tickets come from.** `/capture` an idea → `/align` it against your objectives (a markdown KB, not vibes) → `/plan` it into a project → `/spawn-tickets` a traced, acceptance-checklisted ticket tree in Linear.
- **Center — execution.** `/next-ticket` → `/scope` (validate the ticket against the real code, emit a build plan) → `/build` (with an adversarial `/thesis-check` on the design) → `/verify-tests` → `/land-ticket` (PR, review, merge, close — with hard gates on anything irreversible).
- **Right wing — proving it works.** `/validate` (system-level close-out that refuses to pass while an owed principle is undischarged), `/review-produced`, `/scorecard`, `/periodic-review`.

Around the V, **standing machinery**: every tool failure lands in an errors log that a daily harvester turns into deduped bug tickets; subjective feedback lands in a feedback log with its own harvester; daily plan/summary rituals; a git-hygiene sweep; a self-review loop that mines transcripts for permission-rule and correctness findings.

## The layers

| Layer | Where | What |
|---|---|---|
| Skills (46) | `commands/` | The verbs — each a markdown skill Claude reads and adapts |
| Deterministic helpers (~100) | `bin/` | Guards, hooks, loggers, runners, installers — stdlib-only node/bash/python, with a real test suite |
| Judgment register | `craft/` | The read-first craft layer skills consult before judgment calls |
| Lesson registers | `memory/` | Durable lessons shipped commands cite by path |
| Knowledge base | `pipeline/` | Objectives, principles (phase-weighted, with *deferred-but-owed* enforcement), landscape, decisions — curated markdown, partly derived from Linear |
| Conventions | `workflow-conventions.md` + siblings | The procedure constitution every multi-step skill follows |
| Harness config | `settings.example.json`, `CLAUDE.example.md` | Permissions, hooks, autoMode policy, root instructions |

## Prerequisites

- **Claude Code** (the pipeline is built on its skills + hooks + settings mechanics)
- **A Linear workspace** — Linear is the ticket DB and trace backbone. Recommended: the token-frugal self-hosted MCP wrapper [linear-mcp-lean](https://github.com/wiklob/linear-mcp-lean) (same author); the hosted `mcp.linear.app` works too.
- **macOS** for the scheduled rituals (launchd). Everything else is POSIX-portable; systemd units are a welcome contribution.
- `node` ≥ 18, `python3`, `git`, `gh`, `jq`, `direnv`; bash ≥ 4 for a few scripts (`brew install bash`).
- Optional: Supabase CLI + `squawk-cli` (the migration-safety module no-ops without a `supabase/` dir; squawk is needed by `migration-lint` and its tests).

## Quickstart

```bash
git clone https://github.com/wiklob/v-coding-setup.git
cd v-coding-setup
./install.sh --dry-run   # see what it would do
./install.sh             # engine → symlinks; KB + config → seeded once, never overwritten
```

Then follow the printed manual steps: PATH for the bare-verb helpers, Linear MCP, `~/.claude/.envrc` for tokens, optional launchd rituals. Per repo you work in: `/ticket-flow-init`. Seed `~/.claude/pipeline/objectives.md`, then start with `/capture` → `/align` → `/plan` → `/spawn-tickets` → `/next-ticket`.

The installer is **non-destructive**: engine files are per-file symlinks (a `git pull` here updates the live install; your own commands/bin files are never hidden), collisions are backed up, and your KB/config are seeded from templates exactly once.

## Security model

The permission stance is *allow-broad, block-narrow*, enforced in layers: settings **deny rules** for secret files and destructive git; a **PreToolUse guard** (`bin/guard-sensitive-access.py`) that catches what prefix rules structurally can't (interpreter exfil, pipe-split reads, env dumps, permission-bypass flags, prod-mutating commands buried mid-chain); **ask gates** on prod-facing verbs; and an autoMode policy whose hard-deny rules forbid credentials ever appearing in a transcript. Secrets live in `~/.claude/.envrc` (direnv), are *used* implicitly and never displayed. Session transcripts are readable only through a redacting resolver. CI runs the test suite, a scrub gate, and gitleaks.

## Scheduled rituals (all optional)

| Job | Schedule | What |
|---|---|---|
| harvest-pipeline-bugs | daily 09:07 | errors.jsonl → deduped bug tickets |
| harvest-feedback | daily 09:17 | feedback.jsonl → routed action |
| schedule-brief | daily 09:27 | morning brief of registered routines |
| daily-plan | daily 09:27 | dated plan artifact from yesterday + KB |
| git-hygiene | daily 09:27 | fast-forward mains, prune dead branches/worktrees |
| docs-refresh | daily 09:47 | one consolidated docs PR for the day's lands |
| daily-summary | daily 20:37 | evening recap artifact |
| periodic-review | Mon 09:27 | consumes the measurement loop, emits actioned summary |

Install each with its `bin/install-*-launchd.sh`; every runner heartbeats to a log so silent non-execution is distinguishable from "never fired".

**docs-refresh is multi-repo.** The one `docs-refresh` agent sweeps every checkout that opts into daily doc maintenance — `~/.claude` always, plus any absolute path listed one-per-line in `~/.claude/docs-refresh-repos.txt` (`#` comments allowed). A checkout opts in by setting `docs.maintenance: "daily"` in its `.claude/ticket-flow.json` (see the `docs` block in `.claude/ticket-flow.example.json`); a repo left at the default `"per-land"` is skipped, and does its doc upkeep at land time instead. Each repo keeps its own review watermark and gets its own daily PR; a failure in one repo never blocks the rest. Adding a repo is a one-line registry edit, not another agent.

## Testing

```bash
bash bin/run-tests.sh        # 35 test files + self-testing probes
bash .github/scrub-gate.sh   # the no-personal-strings gate
```

## Multi-model support

The pipeline is harness-bound (Claude Code), **not** model-bound. Model routing lives in a standalone sibling tool, [claude-model-router](https://github.com/wiklob/claude-model-router) — a tiny loopback router for the Anthropic API surface that forwards each request to the upstream serving its model id: `claude-*` passes through to Anthropic with your auth untouched; foreign ids go to a translating proxy of your choice (e.g. CLIProxyAPI).

```bash
npm install -g @wiklob/claude-model-router
model-router install-launchd     # daemon on localhost:8399, survives reboots
```

Point every session at it once — in `~/.claude/settings.json`: `"env": { "ANTHROPIC_BASE_URL": "http://localhost:8399" }`. Model choice is then per-conversation from any launcher (terminal, agents view, background jobs): `claude --model <id>` at launch or `/model <id>` mid-session.

Per convention 12, author a posture profile (`pipeline/profiles/<model>.md`) for each model you run — until then sessions use the conservative default. To run a routed model at its full window, append `[1m]` (`claude --model 'gpt-5.6-sol[1m]'`); its verified capacity + provenance live in `models/custom-models.json` (validated by `bin/custom-model-metadata.mjs`, which won't recommend extended mode until a probe proves the route past 200K). Details + caveats: [docs/multi-model-support.md](docs/multi-model-support.md).

## Relationship to linear-mcp-lean

The pipeline drives Linear hard, so it pairs with [linear-mcp-lean](https://github.com/wiklob/linear-mcp-lean) — a self-hosted Linear MCP server with byte-trimmed reads and minimal write acks. `bin/linear-wrapper-toggle.mjs` routes the `linear` MCP server between your wrapper deployment (`LINEAR_MCP_WRAPPER_URL`) and the hosted endpoint, globally or per-path.

## License

MIT
