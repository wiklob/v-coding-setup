# Build plan: V-372 — EnterWorktree safety-gate worktree migration
Status: ready
Created: 2026-07-15 by /scope
Ticket: https://linear.app/wiklob/issue/V-372/enterworktree-21206-safety-gate-makes-every-sibling-worktree-go-run
Parent plan: none — standalone

## Goal
Move ordinary ticket-flow worktrees into each repository's Claude-managed `.claude/worktrees/` area while preserving deterministic branches, reuse, migration, and teardown. Move ticket binding state out of the protected checkout `.claude/` tree, retain an explicit temporary exception for the legacy `~/.claude` source checkout until V-376 cuts source ownership over, and prove the behavior on Claude Code 2.1.210.

## Approach
Add one installed helper as the source of truth for ticket-worktree layout and binding state. It will preserve the existing deterministic worktree basename, prefer `<repo>/.claude/worktrees/<basename>` for ordinary repositories, expose the legacy sibling path for migration, retain the sibling path only when the source root is exactly `~/.claude`, and store the JSON binding at the current worktree's private Git metadata path resolved by `git rev-parse --path-format=absolute --git-path`.

Update every command and helper that derives a worktree path or reads `.claude/active-project.json` to use that helper. Existing registered sibling worktrees will move in place with `git worktree move` when the managed path is free; legacy binding files will migrate atomically into Git-private metadata. Add executable regression coverage for path selection, sibling migration, binding isolation/migration, orphan classification, and prompt-sensitive runtime probes; document the observed interactive/background matrix separately from normative upstream behavior.

## Prior art & standards
**Topic:** Claude Code-managed ticket worktrees with per-worktree binding metadata
**Industry standard(s):** Claude Code defaults worktrees to `<repository>/.claude/worktrees/<name>` and requires an unsuppressible approval before entering an existing path outside that directory; Git defines `$GIT_DIR` as the current linked worktree's private administrative state and recommends resolving paths through `git rev-parse` rather than assuming `.git` is a directory — https://code.claude.com/docs/en/worktrees · https://git-scm.com/docs/git-worktree · https://git-scm.com/docs/gitrepository-layout.html
**Candidates:**
- **Claude Code managed worktree layout** (reference architecture) — **adapt**: retain the pipeline's Linear branch naming and deterministic reuse while relocating its paths under the documented managed directory. https://code.claude.com/docs/en/worktrees
- **Git per-worktree administrative directory** (native metadata seam) — **adapt**: store the existing JSON payload at a path resolved from the private `$GIT_DIR`, avoiding both checkout dirtiness and the protected `.claude` write surface. https://git-scm.com/docs/gitrepository-layout.html
- **`git config --worktree`** (native configuration mechanism) — **build-fresh**: do not enable it here because it requires the repository-wide `extensions.worktreeConfig` switch and introduces compatibility/migration concerns for a small opaque JSON binding; use a helper-managed private Git metadata file instead. https://git-scm.com/docs/git-worktree
**Recommendation:** Adapt Claude Code's managed layout plus Git's private worktree metadata. Preserve the current sibling layout only for the legacy `~/.claude` source root until V-376 removes that source-repository special case.

## Implementation design
1. **Approach** — Introduce `bin/ticket-worktree.mjs` as the single executable contract for deterministic path resolution, ordinary-repo managed-path preference, legacy-source fallback, registered sibling-to-managed migration, and private binding read/write/migration. Command prose calls the helper instead of re-deriving paths or touching a protected checkout marker.
2. **Affected seams/files** — `bin/ticket-worktree.mjs` + its tests; `commands/next-ticket.md`, `commands/resume-ticket.md`, `commands/bulk-fix.md`; binding readers in `commands/build.md`, `commands/scope.md`, `commands/validate.md`, `commands/thesis-check.md`, `commands/audit-cycle.md`, and `commands/land-ticket.md`; `bin/orphan-detect.sh` + test, `bin/bootstrap-worktree-perms.sh`, `bin/probe-claude-gate.sh`, settings fixtures, `.gitignore`, `commands/ticket-flow-init.md`, `workflow-conventions.md`, and `workflow-chains.md`.
3. **Intended change shape** — The helper returns both managed and legacy deterministic paths, marks which is preferred, creates no worktree implicitly, migrates a registered legacy worktree with `git worktree move` only when the managed target is absent, and stores validated binding JSON at `git rev-parse --path-format=absolute --git-path claude-ticket-flow.json`. `/next-ticket` uses the helper before its existing leftover/orphan checks, enters only the selected managed path for ordinary repositories, writes the binding through the helper, and preserves the exact Linear branch. `/resume-ticket`, `/bulk-fix`, `/land-ticket`, and all binding consumers use the same contract. Regression probes assert that no active binding file is written under `<worktree>/.claude/`.
4. **Alternatives considered** — Using `EnterWorktree(name:)` for creation was rejected because Claude Code controls its `worktree-*` branch and only supports `fresh|head` base selection, while ticket flow must use the Linear branch verbatim and the configured base branch. Keeping `.claude/active-project.json` but writing it via a shell helper was rejected because it preserves checkout-local protected-path state and its gitignore/dirtiness failure mode. `git config --worktree` was rejected because enabling `extensions.worktreeConfig` is a repository-wide compatibility decision disproportionate to this JSON binding.
5. **Risks / unverified premises** — Official Claude docs still state external existing paths require approval and managed paths do not; this background `/go` on Claude Code 2.1.210 nevertheless entered the external sibling path without a prompt, so the matrix must record normative docs and observed mode-specific behavior separately. A throwaway Git probe on 2026-07-15 verified that `git worktree move` can relocate a registered sibling into `<repo>/.claude/worktrees/<name>` and that `git rev-parse --git-path` resolves a private linked-worktree marker. Nested managed contents must be ignored by the parent checkout. The exact `~/.claude` source root remains on the sibling fallback until V-376 (currently Backlog) completes; this ticket must not patch installed `~/.claude` as source. Interactive prompt behavior remains a human-observed verification item at land if it cannot be automated honestly.

## Pre-build validation
- [x] Acceptance item 1 — implementable · kind: `manual-verify`. Claude Code 2.1.210 is installed; official docs define the external-path confirmation rule, and this background run observed an external `EnterWorktree(path:)` entering silently. Build will add the reproducible matrix/probe and obtain a real interactive observation rather than infer it.
- [x] Acceptance item 2 — implementable · kind: `code`. `commands/next-ticket.md:47-70` contains the complete deterministic sibling path/create/enter seam and can consume one helper-backed managed path.
- [x] Acceptance item 3 — implementable · kind: `code`. Branch creation is isolated at `commands/next-ticket.md:101-113`; reuse/orphan handling is at `commands/next-ticket.md:53-84`; teardown is path-agnostic at `commands/land-ticket.md:423-446` and `bin/worktree-remove.sh`.
- [x] Acceptance item 4 — implementable · kind: `invariant`. The current protected marker write is explicit at `commands/next-ticket.md:61-65`; Git 2.39.5 empirically resolves a private linked-worktree metadata path. Met only when tests/probes prove binding I/O targets Git-private metadata and no active checkout marker is created.
- [x] Acceptance item 5 — implementable · kind: `code`. The implementation will special-case the exact legacy source root, document V-376 as the cutover owner, and make no source edit in installed `~/.claude`; V-376 is Backlog, so this ticket preserves a temporary compatibility branch rather than fabricating its completion.
- [x] Acceptance item 6 — implementable · kind: `invariant`. The repo has `bin/run-tests.sh`; build will add end-to-end fixtures and current-version runtime probes. Prompt absence is not inferred from code presence and remains unverified until the probe/matrix records observed results.

(Build-check: pass — `bash bin/run-tests.sh -q` ran 35 checks with 0 failures on 2026-07-15.)

## Implementation steps
1. `bin/ticket-worktree.mjs` + `bin/ticket-worktree.test.mjs` — implement and prove managed/legacy path resolution, registered sibling migration, private binding storage, atomic legacy-marker migration, and malformed/conflicting-state refusal. Satisfies Acceptance 2–4.
2. `commands/next-ticket.md`, `commands/resume-ticket.md`, `commands/bulk-fix.md` — replace sibling derivation with the helper contract, preserve Linear branch/base semantics, migrate existing siblings, and enter the selected path. Satisfies Acceptance 2–3.
3. `commands/build.md`, `commands/scope.md`, `commands/validate.md`, `commands/thesis-check.md`, `commands/audit-cycle.md`, `commands/land-ticket.md`, `bin/orphan-detect.sh` — route every binding presence/read through the helper; update orphan tests to exercise Git-private binding state. Satisfies Acceptance 3–4.
4. `.gitignore`, `commands/ticket-flow-init.md`, `settings.example.json`, `bin/bootstrap-worktree-perms.sh`, `bin/probe-claude-gate.sh`, and settings/probe fixtures — ignore managed contents, remove the obsolete protected marker Write allowance, keep scoped permission bootstrap valid, and replace the old marker-write probe with the new no-protected-write proof. Satisfies Acceptance 1, 4, and 6.
5. `workflow-conventions.md`, `workflow-chains.md`, and a focused worktree-permission matrix doc — record managed ordinary paths, the Git-private binding contract, sibling migration/coexistence, current upstream rules, observed 2.1.210 interactive/background results, and the V-376 legacy-source boundary. Satisfies Acceptance 1 and 5.
6. Run targeted helper/orphan/probe tests, the full `bin/run-tests.sh`, and real current-version `/next-ticket` + `/go` setup probes without applying any code-review command. Satisfies Acceptance 6.

## Risks / gotchas
- Preserve the existing worktree basename so legacy sibling detection and migration are deterministic; changing both parent and basename would make ownership ambiguous.
- A managed worktree is nested under a checkout but remains a normal linked worktree; use `git worktree list --porcelain` as authority, never directory presence alone.
- If both managed and legacy registered paths exist for one deterministic name, stop as ambiguous; never delete or merge them automatically.
- The binding helper must resolve the worktree's private Git directory from the target worktree itself, not from the caller's current repository.
- The helper may migrate an old checkout marker only after parsing it and proving any existing private binding is identical; conflicting state is a hard failure.
- Keep `~/.claude`'s temporary sibling fallback explicit and narrow. Generalizing it to every path containing `.claude` would defeat the ordinary managed migration.
- Do not claim interactive prompt behavior from a non-interactive/background probe; record each mode's actual observation.

## Verification strategy
- `/verify-tests` scope: `bin/ticket-worktree.test.mjs`, `bin/orphan-detect.test.sh`, permission/probe fixtures, and all existing shell/Node checks.
- Build check: `bash bin/run-tests.sh -q`, then the full non-quiet suite if a failure needs diagnosis.
- Runtime: on Claude Code 2.1.210, exercise managed `EnterWorktree(name:)`, managed `EnterWorktree(path:)`, external sibling `EnterWorktree(path:)`, legacy binding migration, `/next-ticket`, reuse, and teardown in disposable repositories; distinguish background/non-interactive from interactive observations.
- Manual: if the interactive confirmation surface cannot be captured by the session, the user reports the observed result for each interactive matrix row before merge.

## Deviations
(none yet)
