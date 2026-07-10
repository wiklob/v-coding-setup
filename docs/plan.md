# v-coding-setup — build plan

Open-source extraction of the "v pipeline": an autonomous dev pipeline built on Claude Code (skills, hooks/guards, scheduled rituals, Linear ticket flow, markdown-in-git knowledge base). Source being ported: the git-tracked subset of `~/.claude` (private repo `wiklob/v`, 424 tracked files, 762 commits).

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
| cbapp/Supabase | **Revised at port (2026-07-10):** the `sb-*` helpers turned out to be fully generic, env-var-driven Supabase tooling (the "cbapp-specific" premise was wrong) and are deeply cross-referenced by guards/commands/CI — the whole Supabase module ships. Only `relocate-cbapp.sh` (genuinely product-specific) is stripped. |
| v1 scope | Claude Code + Linear + macOS/launchd are **documented prerequisites**, not abstracted away |

## Source analysis (done 2026-07-10)

- **No live secrets** in any tracked file or anywhere in the 762-commit history (verified: `.credentials.json`/`.envrc` never committed; no token patterns in history).
- The risk is **identity/infra disclosure**, concentrated in engine files (see scrub list).
- The engine/state boundary in the source is clean; most personal fingerprint (182 `linear.app/wiklob` URLs, hundreds of V-/CB- ticket refs) lives in state files that don't ship.

### Scrub list (becomes the CI grep-gate)

`wiklob` · `Wiktor` · `178.104.140.96` · `linear-mcp.wiklob.dev` · `linear.app/wiklob` · Linear UUIDs (63 in source, incl. `ticket-flow.json` buckets) · `com.wiklob.claude.*` launchd labels (74×) · `cbapp` / `/opt/cbapp` (62 files) · `/Users/wiklob` hardcoded paths (142×, worst: `settings.json` with 22, `bin/check-no-hardcoded-repo-cd.sh`, `bin/probe-claude-gate.sh`, guard test fixtures) · Supabase project details · `~/.ssh/id_ed25519` references.

## What ships — port checklist

- [x] **bin/** (103 files, done 2026-07-10): all guards/hooks/loggers/runners/installers/helpers + test suite ported. Genericized: launchd labels → `com.v-coding-setup.*`; `LINEAR_MCP_WRAPPER_URL` env replaces the hardcoded wrapper URL; `check-no-hardcoded-repo-cd.sh` + `probe-claude-gate.sh` derive patterns from `$HOME`/ticket-flow at runtime; `guard-repo-cd.test.sh` rewritten hermetic (sandbox HOME + checkout); `git-hygiene-runner.sh` reads extra repos from optional `~/.claude/git-hygiene-repos.txt`; fixtures → `/Users/testuser`/`myapp`. Stripped: `relocate-cbapp.sh` only (sb-* kept — see decision). Gate: 33/33 tests + 2 probes green.
- [ ] **commands/** (46 skills) — scrub personal refs; verbs unchanged.
- [ ] **craft/** (8 judgment registers), **memory/** (4 lesson registers — already generic), **templates/** (`ci/migration-collision-check.yml`), **scripts/** (`ingest-convo.py`).
- [ ] **pipeline/** mechanism: `README.md`, `principles.md`, `review-standard.md`, `profiles/`, `schedule-registry.json` (empty). KB content files (`objectives.md`, `roadmap.md`, `landscape.md`, `decisions.md`, `owed.md`, `parked.md`, `decision-ledger.md`) ship as **blank templates** + an init flow.
- [ ] **Root convention docs**: `workflow-conventions.md`, `workflow-chains.md`, `commands-reference.md`, `log-reading-playbook.md`, `usage-stats.md`, `screenshot-recipe.md` — scrubbed.
- [ ] **~19 engine docs** from `docs/` (design/decision/finding docs) — scrubbed (VPS IP, handles); curate which earn a place.
- [ ] **settings fragment**: hooks + generic permissions + autoMode policy, **minus** the identity block (source `settings.json:345-348`), the `ssh root@<VPS>` rule, and all cbapp/Supabase-specific rules. Ships as a fragment + merge script/instructions — never a whole `settings.json` that clobbers the user's.
- [ ] **CLAUDE.md template** — the generic discipline sections (bash-call discipline, ugrep gotcha, literal tool paths).
- [ ] **`ticket-flow.example.json`** — schema + placeholders; real team/bucket UUIDs never ported.
- [ ] **Excluded entirely**: `docs/plans/*-build.md` (166 per-ticket artifacts), `plans/` (21 strategy docs), `pipeline/audit/` content, `pipeline-status.md`, `commands-rework-agenda.md`, `usage-stats.md`-style trackers' *content*, `services/linear-mcp/` (superseded → README pointer to linear-mcp-lean). Optionally 1–2 build plans return later, genericized, as worked examples.

## Phases

**A — Port + genericize the engine.** Order: bin + tests (green = gate) → commands → craft/memory/templates/scripts → pipeline mechanism → convention docs → engine docs → settings fragment → ticket-flow example → CLAUDE.md template.

**B — Packaging.** `install.sh`: non-destructive symlink/copy into `~/.claude` (back up collisions), settings-fragment merge, interactive `ticket-flow.json` generation, optional launchd install, PATH instructions. README with architecture + quickstart. CONTRIBUTING. `.github/` CI: bin test suite + scrub-list grep-gate + gitleaks.

**C — Launch.** Clean-room install test (fresh account/VM); empirical scrub probe of the published tree (grep the scrub list — probe, don't trust artifact presence); flip repo public; description/topics; optional demo recording.

**D — (Deferred, post-build, separate decision.)** Migrate the live `~/.claude` to install-from-this-repo; shrink `wiklob/v` to state-only or archive it.

## Prerequisites (v1, documented not abstracted)

Claude Code (hooks + skills + settings), a Linear workspace (self-hosted [linear-mcp-lean](https://github.com/wiklob/linear-mcp-lean) recommended), macOS for the launchd rituals, node ≥ 18 (bin scripts are stdlib-only), `gh`, `jq`, `direnv`, `git`.
