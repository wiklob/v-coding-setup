# v-coding-setup — build plan

Open-source extraction of the "v pipeline": an autonomous dev pipeline built on Claude Code (skills, hooks/guards, scheduled rituals, Linear ticket flow, markdown-in-git knowledge base). Source being ported: the git-tracked subset of `~/.claude` (private repo `github.com/wiklob/v`, 424 tracked files, 762 commits).

## Working model (how this repo is built)

- This folder is a **git worktree of `~/.claude`** on orphan branch `oss-main` — no shared history; the root commit is clean by construction.
- **`~/.claude` is read-only reference.** The live setup must not be modified during the build. Files are *ported* here and genericized in the same motion — never edited in place at the source.
- Remote: `oss` → `github.com/wiklob/v-coding-setup` (**private** until the Phase-C audit). Push with `git push oss oss-main:main` (local branch name `main` is taken by the host repo; the remote branch is plain `main`).
- After the build: push, fresh clone becomes the standalone home, then remove the tether (`git worktree remove` + `git branch -D oss-main` in `~/.claude`, drop the `oss` remote).
- Migrating the live `~/.claude` to install from this repo is a **separate post-build decision** (Phase D) — explicitly out of scope until the build is complete.

## Decisions (2026-07-10)

| Decision | Choice |
|---|---|
| Repo model | Build by porting into a fresh repo; `~/.claude` untouched; canonical-migration decided post-build |
| Name | `v-coding-setup` |
| GitHub | Created private immediately; flips public only after the Phase-C clean-room audit |
| History | Fresh (orphan root). Optional: hand-written `HISTORY.md` narrating the 762-commit self-development arc |
| License | MIT, `Copyright (c) 2026 wiklob` (matches linear-mcp-lean) |
| product-app/Supabase | **Revised at port (2026-07-10):** the `sb-*` helpers turned out to be fully generic, env-var-driven Supabase tooling (the "product-specific" premise was wrong) and are deeply cross-referenced by guards/commands/CI — the whole Supabase module ships. Only the product-relocation helper (genuinely product-specific) is stripped. |
| v1 scope | Claude Code + Linear + macOS/launchd are **documented prerequisites**, not abstracted away |

## Source analysis (done 2026-07-10)

- **No live secrets** in any tracked file or anywhere in the 762-commit history (verified: `.credentials.json`/`.envrc` never committed; no token patterns in history).
- The risk is **identity/infra disclosure**, concentrated in engine files (see scrub list).
- The engine/state boundary in the source is clean; most personal fingerprint (182 workspace-URL references, hundreds of V-/CB- ticket refs) lives in state files that don't ship.

### Scrub list (becomes the CI grep-gate)

the author's handle and full name · the VPS IP · the personal domain · the Linear workspace URL · Linear UUIDs (63 in source, incl. `ticket-flow.json` buckets) · `com.<handle>.claude.*` launchd labels (74×) · the product app's name (62 files) · `/Users/<handle>` hardcoded paths (142×, worst: `settings.json` with 22, `bin/check-no-hardcoded-repo-cd.sh`, `bin/probe-claude-gate.sh`, guard test fixtures) · Supabase project details · SSH key-path references. (Literal values live in the private source repo's copy of this plan.)

## What ships — port checklist

- [x] **bin/** (103 files, done 2026-07-10): all guards/hooks/loggers/runners/installers/helpers + test suite ported. Genericized: launchd labels → `com.v-coding-setup.*`; `LINEAR_MCP_WRAPPER_URL` env replaces the hardcoded wrapper URL; `check-no-hardcoded-repo-cd.sh` + `probe-claude-gate.sh` derive patterns from `$HOME`/ticket-flow at runtime; `guard-repo-cd.test.sh` rewritten hermetic (sandbox HOME + checkout); `git-hygiene-runner.sh` reads extra repos from optional `~/.claude/git-hygiene-repos.txt`; fixtures → `/Users/testuser`/`myapp`. Stripped: the product-relocation helper only (sb-* kept — see decision). Gate: 33/33 tests + 2 probes green.
- [x] **commands/** (46 skills, done 2026-07-10) — scrubbed; refresh-landscape/trace-audit teams → `cfg.landscapeTeams`, capture/align funnel → `cfg.intake`, examples → placeholders.
- [x] **craft/**, **memory/**, **templates/**, **scripts/** (done 2026-07-10) — ported byte-identical, scrub-clean.
- [x] **pipeline/** (done 2026-07-10): mechanism ported scrubbed (README, principles w/ seed-example note, owed read-schema, review-standard, decision-ledger emptied, profiles/, audit/README); KB content files ship as blank templates; `schedule-registry.json` = `[]`. Audit findings docs excluded.
- [x] **Root convention docs** (done 2026-07-10): `workflow-conventions.md`, `workflow-chains.md`, `commands-reference.md`, `usage-stats.md`, `screenshot-recipe.md` — scrubbed. `log-reading-playbook.md` EXCLUDED (personal-infra runbook; the pattern is noted as per-product).
- [x] **engine docs** (done 2026-07-10): 12 curated into `docs/` (all engine-cited docs + Decision docs: implementation-design-rung, research-route/fix-bug path designs, stale-skill-execution, design-is-upstream, autonomous-go-class, git-hygiene, migration-collision-guard, large-build-context-budget, craft-ab-harness, v-174 token-cost, v-194 repro script) — scrubbed/de-linked. Dated findings + security baseline excluded.
- [x] **settings.example.json** (done 2026-07-10): hooks (all `~/.claude/bin/...`), generic permissions (identity block, VPS/ssh rule, product rules stripped; bare-verb ask-gates added; the source's broad `Bash(*)` allow deliberately NOT shipped — curated allows instead), autoMode with placeholder environment block. Installer merges/copies with backup — never clobbers.
- [x] **CLAUDE.example.md** (done 2026-07-10) — terseness + bash-call discipline + ugrep (made conditional) + literal tool paths.
- [x] **`.claude/ticket-flow.example.json`** (done 2026-07-10) — full schema incl. new `landscapeTeams` + `intake` keys, placeholder values, generic notes; no real UUIDs.
- [ ] **Excluded entirely**: `docs/plans/*-build.md` (166 per-ticket artifacts), `plans/` (21 strategy docs), `pipeline/audit/` content, `pipeline-status.md`, `commands-rework-agenda.md`, `usage-stats.md`-style trackers' *content*, `services/linear-mcp/` (superseded → README pointer to linear-mcp-lean). Optionally 1–2 build plans return later, genericized, as worked examples.

## Phases

**A — Port + genericize the engine.** Order: bin + tests (green = gate) → commands → craft/memory/templates/scripts → pipeline mechanism → convention docs → engine docs → settings fragment → ticket-flow example → CLAUDE.md template.

**B — Packaging** *(done 2026-07-10)*. `install.sh` (per-file symlink engine / copy-if-absent KB+config, backups, --dry-run, printed manual steps — smoke-tested against a sandbox CLAUDE_CONFIG_DIR, idempotent). README (architecture, quickstart, security model, rituals table). CONTRIBUTING. CI: `bin/run-tests.sh` on macos-latest + `.github/scrub-gate.sh` (two-tier: hard strings anywhere, bare handle outside LICENSE/README/plan/github-URLs) + gitleaks.

**C — Launch.** Clean-room install test (fresh account/VM); empirical scrub probe of the published tree (grep the scrub list — probe, don't trust artifact presence); flip repo public; description/topics; optional demo recording.

**Post-audit addition (2026-07-13) — multi-model support.** `bin/claude-via` (+ hermetic test): launch Claude Code on a named model route — Anthropic-native or any provider behind a Claude-API-compatible proxy; routes in `~/.claude/model-routes.json` (example shipped), proxy token via `.envrc`, subagents default to the route model, convention-12 profile warning. `docs/multi-model-support.md` + README section.

**Superseded (2026-07-14):** `claude-via` + routes template removed. Routing moved to the standalone [claude-model-router](https://github.com/wiklob/claude-model-router) (npm `@wiklob/claude-model-router`) — a loopback daemon routing every request by model id, making model choice per-conversation from any launcher (`/model <id>`), agents view included. Docs + install step 7 rewritten around it.

**D — (Deferred, post-build, separate decision.)** Migrate the live `~/.claude` to install-from-this-repo; shrink `wiklob/v` to state-only or archive it.

## Prerequisites (v1, documented not abstracted)

Claude Code (hooks + skills + settings), a Linear workspace (self-hosted [linear-mcp-lean](https://github.com/wiklob/linear-mcp-lean) recommended), macOS for the launchd rituals, node ≥ 18 (bin scripts are stdlib-only), `gh`, `jq`, `direnv`, `git`.
